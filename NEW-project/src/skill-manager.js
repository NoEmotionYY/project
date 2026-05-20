/**
 * AI 技能管理器 (v2)
 * 支持多技能并行、启用/禁用、动态文件加载
 *
 * 技能接口规范 (Skill Interface):
 *   module.exports = {
 *     name: string,                    // 技能唯一标识
 *     label: string,                   // UI 显示名称
 *     description: string,             // 简短描述
 *     analyze(base64Image: string): Promise<AnalysisResult>
 *   }
 *
 * AnalysisResult 格式:
 *   {
 *     text: string,              // AI 分析文本
 *     alert: boolean,            // 是否有安全风险
 *     alert_details: string[],   // 风险类别列表
 *     voice_reminder: boolean,
 *     voice_text: string,
 *     voice_texts: string[],
 *     risk_level: string,        // none / low / medium / high
 *     cleanup_hint: string,
 *     evacuate_reminder: boolean,
 *     evacuate_text: string
 *   }
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const STATE_FILE = path.resolve(SKILLS_DIR, 'skills-state.json');
const MANAGER_FILE = path.basename(__filename);
const ALLOWED_INSTALL_EXTENSIONS = new Set(['.js', '.py']);
const PROTECTED_SKILL_FILES = new Set(['qwen-vl.js', 'yolo-safety.py', 'audio-detector.js', 'skills-state.json', MANAGER_FILE]);

function safeName(input, fallback = 'default') {
  const safeFallback = String(fallback || 'default').replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
  const value = String(input || safeFallback);
  const base = path.basename(value);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!cleaned || cleaned === '.' || cleaned === '..') return safeFallback;
  return cleaned;
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return target;
}

function validateInstallFileName(fileName) {
  const original = String(fileName || '');
  const base = path.basename(original);
  if (!base || base !== original) {
    throw new Error('技能文件名不能包含路径');
  }
  const cleaned = safeName(base, '');
  if (!cleaned || cleaned !== base) {
    throw new Error('技能文件名包含非法字符');
  }
  const ext = path.extname(cleaned).toLowerCase();
  if (!ALLOWED_INSTALL_EXTENSIONS.has(ext)) {
    throw new Error('仅支持 .js 或 .py 技能文件');
  }
  if (PROTECTED_SKILL_FILES.has(cleaned)) {
    throw new Error('禁止覆盖或安装为核心技能文件名');
  }
  return cleaned;
}

function resolveSkillDestination(fileName) {
  return resolveInside(SKILLS_DIR, validateInstallFileName(fileName));
}

function parseInstalledSkillInfo(fileName, content = '') {
  const ext = path.extname(fileName).toLowerCase();
  const fallbackId = safeName(path.basename(fileName, ext), 'skill');
  let id = fallbackId;
  let label = fallbackId;
  let description = '';

  if (ext === '.py') {
    try {
      const meta = parsePythonMeta(resolveInside(SKILLS_DIR, fileName));
      id = safeName(meta.name || fallbackId, fallbackId);
      label = meta.label || id;
      description = meta.description || '';
    } catch (_) {}
  } else {
    const nameMatch = String(content).match(/\bname\s*:\s*['"`]([^'"`]{1,80})['"`]/);
    const labelMatch = String(content).match(/\blabel\s*:\s*['"`]([^'"`]{1,120})['"`]/);
    const descMatch = String(content).match(/\bdescription\s*:\s*['"`]([^'"`]{1,200})['"`]/);
    if (nameMatch) id = safeName(nameMatch[1], fallbackId);
    if (labelMatch) label = labelMatch[1];
    if (descMatch) description = descMatch[1];
  }

  return { id, label, description, file: fileName, type: ext === '.py' ? 'python' : 'js', enabled: false, installed: true };
}

function markInstalledSkillDisabled(skillInfo) {
  enabledState[skillInfo.id] = false;
  enabledState[path.basename(skillInfo.file, path.extname(skillInfo.file))] = false;
  saveState();
  loadedSkills.delete(skillInfo.id);
}

// Python 解释器路径
const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

// 风险优先级权重
const RISK_WEIGHT = { none: 0, low: 1, medium: 2, high: 3 };

// 运行时状态: Map<id, { module, info }>
const loadedSkills = new Map();
// 技能启用状态: { [id]: true/false }
let enabledState = {};

// 持久 Python 进程管理: Map<id, { procInfo, disposed, failed?, failReason? }>
const persistentProcesses = new Map();
const MAX_RESTART = 1;  // 最多重启 1 次，启动失败就放弃，避免无限重启卡住分析循环

// 加载失败的技能记录: Map<id, failReason>
const failedSkills = new Map();

// ==========================================
// 状态持久化
// ==========================================
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      enabledState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (_) {
    enabledState = {};
  }
}

function saveState() {
  try {
    if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(enabledState, null, 2));
  } catch (e) {
    console.error('[技能] 保存状态失败:', e.message);
  }
}

function isEnabled(id) {
  return enabledState[id] === true;
}

// ==========================================
// Python 元数据解析
// ==========================================
function parsePythonMeta(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const meta = { name: '', label: '', description: '', persistent: false };

  for (const line of content.split('\n')) {
    const mName = line.match(/^#\s*@name:\s*(.+)/);
    const mLabel = line.match(/^#\s*@label:\s*(.+)/);
    const mDesc = line.match(/^#\s*@description:\s*(.+)/);
    const mPersist = line.match(/^#\s*@persistent:\s*(.+)/);

    if (mName) meta.name = mName[1].trim();
    if (mLabel) meta.label = mLabel[1].trim();
    if (mDesc) meta.description = mDesc[1].trim();
    if (mPersist) meta.persistent = (mPersist[1].trim().toLowerCase() === 'true');

    if (line.trim() && !line.trim().startsWith('#')) break;
  }

  return meta;
}

// ==========================================
// 扫描技能目录
// ==========================================
function getAvailableSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }

  let files;
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (_) {
    return [];
  }

  const exclude = ['__tests__', MANAGER_FILE, 'skills-state.json'];
  const skills = [];
  const seenSkillIds = new Set();

  // 扫描 JS 技能
  for (const file of files) {
    if (!file.endsWith('.js') || file.startsWith('.') || exclude.includes(file)) continue;
    if (safeName(file, '') !== file) continue;
    try {
      const skillPath = resolveInside(SKILLS_DIR, file);
      const content = fs.readFileSync(skillPath, 'utf-8');
      if (!/\bname\s*:\s*['"`]([^'"`]{1,80})['"`]/.test(content)) continue;
      const meta = parseInstalledSkillInfo(file, content);

      skills.push({
        id: meta.id,
        label: meta.label || meta.id,
        description: meta.description || '',
        file,
        type: 'js',
        enabled: isEnabled(meta.id),
      });
      seenSkillIds.add(meta.id);
    } catch (e) {
      console.error(`[技能] 扫描 ${file} 失败:`, e.message);
    }
  }

  // 扫描 Python 技能
  for (const file of files) {
    if (!file.endsWith('.py') || file.startsWith('.') || exclude.includes(file)) continue;
    if (safeName(file, '') !== file) continue;
    try {
      const skillPath = resolveInside(SKILLS_DIR, file);
      const meta = parsePythonMeta(skillPath);
      const name = meta.name || path.basename(file, '.py');
      if (seenSkillIds.has(name)) continue;

      skills.push({
        id: name,
        label: meta.label || name,
        description: meta.description || '',
        file,
        type: 'python',
        enabled: isEnabled(name),
      });
    } catch (e) {
      console.error(`[技能] 扫描 ${file} 失败:`, e.message);
    }
  }

  return skills;
}

// ==========================================
// 持久 Python 进程（行协议通信）
// ==========================================
function createPersistentAnalyzer(skillPath, name) {
  let proc = null;
  let restartCount = 0;
  let readBuffer = '';
  let pending = null; // { resolve, reject, timer }
  let readyResolve = null;
  let isReady = false;

  function startProcess() {
    isReady = false;
    proc = spawn(PYTHON_PATH, [skillPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QWEN_API_KEY: process.env.QWEN_API_KEY || '',
        DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || '',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    proc.stdout.on('data', (data) => {
      readBuffer += data.toString();
      const lines = readBuffer.split('\n');
      readBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          // 跳过就绪信号
          if (response.status === 'ready') {
            isReady = true;
            if (readyResolve) {
              readyResolve();
              readyResolve = null;
            }
            continue;
          }
          // Handle audio events - broadcast to SSE clients
          if (response.event) {
            console.log(`[持久进程:${name}] 广播事件:`, response.event.type);
            // Import broadcastSSE from server context
            if (typeof global.broadcastAudioEvent === 'function') {
              global.broadcastAudioEvent(response.event);
            }
            continue;
          }
          if (pending) {
            clearTimeout(pending.timer);
            const cb = pending;
            pending = null;
            if (response.error) {
              cb.reject(new Error(response.error));
            } else {
              cb.resolve(response.result || response);
            }
          }
        } catch (e) {
          console.error(`[持久进程:${name}] 解析响应失败:`, e.message, line.substring(0, 100));
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString('utf-8').trim();
      if (text) {
        console.error(`[持久进程:${name}] stderr:`, text);
      }
    });

    proc.on('error', (err) => {
      console.error(`[持久进程:${name}] 错误:`, err.message);
      if (pending) {
        pending.reject(err);
        pending = null;
      }
    });

    proc.on('close', (code) => {
      console.log(`[持久进程:${name}] 退出 (code ${code})`);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Python 进程意外退出 (code ${code})`));
        pending = null;
      }
      if (readyResolve) {
        readyResolve();
        readyResolve = null;
      }
      const pEntry = persistentProcesses.get(name);
      if (pEntry && !pEntry.disposed && restartCount < MAX_RESTART) {
        restartCount++;
        console.log(`[持久进程:${name}] 第 ${restartCount} 次重启...`);
        startProcess();
      } else if (pEntry && !pEntry.disposed) {
        // 达到最大重启次数，标记为永久失败
        pEntry.failed = true;
        pEntry.failReason = `Python 进程反复退出 (exit code=${code})，已达到最大重启次数 (${MAX_RESTART})`;
        failedSkills.set(name, pEntry.failReason);
        console.error(`[持久进程:${name}] 已标记为失败: ${pEntry.failReason}`);
      }
    });
  }

  startProcess();

  function waitForReady() {
    if (isReady) return Promise.resolve();
    return new Promise((resolve) => {
      readyResolve = resolve;
    });
  }

  async function analyze(base64Image, context = {}) {
    // 如果已标记为失败，直接快速返回错误，不阻塞分析循环
    const processEntry = persistentProcesses.get(name);
    if (processEntry && processEntry.failed) {
      const errorMsg = `[${name}] 技能加载失败，已跳过: ${processEntry.failReason}`;
      console.error(`[持久进程:${name}] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 等待进程就绪（带超时）
    try {
      await Promise.race([
        waitForReady(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`[${name}] 进程启动超时 (10秒)`)), 10000)
        )
      ]);
    } catch (err) {
      const errorMsg = `[${name}] 进程启动失败: ${err.message}`;
      console.error(`[持久进程:${name}] ${errorMsg}`);
      if (processEntry) {
        processEntry.failed = true;
        processEntry.failReason = err.message;
        failedSkills.set(name, err.message);
      }
      throw new Error(errorMsg);
    }

    return new Promise((resolve, reject) => {
      if (!proc || proc.killed || (processEntry && processEntry.disposed)) {
        if (restartCount >= MAX_RESTART) {
          const errMsg = `[${name}] 已达到最大重启次数 (${MAX_RESTART})`;
          if (processEntry) {
            processEntry.failed = true;
            processEntry.failReason = errMsg;
            failedSkills.set(name, errMsg);
          }
          reject(new Error(errMsg));
          return;
        }
        restartCount++;
        startProcess();
      }

      if (pending) {
        reject(new Error(`[${name}] 上一请求仍在处理中`));
        return;
      }

      const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const timer = setTimeout(() => {
        pending = null;
        proc.kill();
        reject(new Error(`[${name}] 请求超时 (30秒)`));
      }, 30000);

      pending = {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer
      };

      try {
        proc.stdin.write(JSON.stringify({
          ...context,
          image: base64Image,
          request_id: requestId
        }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        pending = null;
        reject(new Error(`[${name}] 写入 stdin 失败: ${e.message}`));
      }
    });
  }

  return {
    analyze,
    dispose: () => {
      const pEntry = persistentProcesses.get(name);
      if (pEntry) pEntry.disposed = true;
      if (proc && !proc.killed) {
        try { proc.stdin.write(JSON.stringify({ shutdown: true }) + '\n'); } catch (_) {}
        proc.kill();
      }
      persistentProcesses.delete(name);
    }
  };
}

function shutdownPersistent() {
  for (const [id, entry] of persistentProcesses) {
    try {
      entry.disposed = true;
      if (entry.procInfo) entry.procInfo.dispose();
    } catch (e) {
      console.error(`[持久进程:${id}] 关闭失败:`, e.message);
    }
  }
  persistentProcesses.clear();
}

// ==========================================
// 技能加载（内部）
// ==========================================
function loadSkillModule(info) {
  const skillPath = resolveInside(SKILLS_DIR, safeName(info.file, 'skill.js'));

  if (info.type === 'python') {
    const meta = parsePythonMeta(skillPath);
    const name = meta.name || path.basename(info.file, '.py');

    // 持久进程技能
    if (meta.persistent) {
      const procInfo = createPersistentAnalyzer(skillPath, name);
      persistentProcesses.set(name, { procInfo, disposed: false });

      return {
        name,
        label: info.label,
        description: info.description,
        type: 'python',
        analyze: (base64Image, context) => procInfo.analyze(base64Image, context),
      };
    }

    // 非持久进程技能（每次调用 spawn 新进程）
    return {
      name,
      label: info.label,
      description: info.description,
      type: 'python',
      async analyze(base64Image, context = {}) {
        return new Promise((resolve, reject) => {
          const python = spawn(PYTHON_PATH, [skillPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              PYTHONIOENCODING: 'utf-8'
            }
          });

          let stdout = '';
          let stderr = '';
          let timedOut = false;

          const timer = setTimeout(() => {
            timedOut = true;
            python.kill();
            reject(new Error(`Python 技能 ${name} 执行超时（30秒）`));
          }, 30000);

          python.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });
          python.stderr.on('data', (data) => { stderr += data.toString('utf-8'); });

          python.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) return;
            if (code !== 0) {
              reject(new Error(`Python 技能 ${name} 异常退出 (code ${code}): ${stderr}`));
              return;
            }
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch (e) {
              reject(new Error(`Python 技能 ${name} 返回非 JSON: ${stdout.substring(0, 200)}`));
            }
          });

          python.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`无法启动 Python (${PYTHON_PATH}): ${err.message}`));
          });

          python.stdin.write(JSON.stringify({ ...context, image: base64Image }));
          python.stdin.end();
        });
      },
    };
  }

  // JS 技能
  delete require.cache[require.resolve(skillPath)];
  const skill = require(skillPath);
  if (!skill || typeof skill.name !== 'string' || typeof skill.analyze !== 'function') {
    throw new Error(`技能 ${info.file} 不符合接口规范`);
  }
  return skill;
}

// ==========================================
// 确保所有已启用技能加载到内存
// ==========================================
function ensureEnabledSkillsLoaded() {
  const all = getAvailableSkills();
  for (const info of all) {
    if (info.enabled && !loadedSkills.has(info.id)) {
      try {
        const module = loadSkillModule(info);
        loadedSkills.set(info.id, { module, info });
        console.log(`[技能] 已启用: ${info.label} (${info.type})`);
      } catch (e) {
        console.error(`[技能] 加载 ${info.label} 失败:`, e.message);
      }
    }
  }
  // 清理已不在扫描列表中的技能
  const currentIds = new Set(all.map(p => p.id));
  for (const [id, entry] of loadedSkills) {
    if (!currentIds.has(id)) {
      // 如果是持久 Python 技能，也清理进程
      if (persistentProcesses.has(id)) {
        const pEntry = persistentProcesses.get(id);
        if (pEntry.procInfo) pEntry.procInfo.dispose();
        persistentProcesses.delete(id);
      }
      loadedSkills.delete(id);
    }
  }
}

function findPersistentPythonSkillInfo(skillId) {
  if (!fs.existsSync(SKILLS_DIR)) return null;
  let files;
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (_) {
    return null;
  }

  for (const file of files) {
    if (!file.endsWith('.py') || file.startsWith('.') || safeName(file, '') !== file) continue;
    try {
      const skillPath = resolveInside(SKILLS_DIR, file);
      const meta = parsePythonMeta(skillPath);
      const name = meta.name || path.basename(file, '.py');
      if (name === skillId && meta.persistent) {
        return {
          id: name,
          label: meta.label || name,
          description: meta.description || '',
          file,
          type: 'python',
          enabled: isEnabled(name),
        };
      }
    } catch (_) {}
  }
  return null;
}

function ensurePersistentActionProcess(skillId) {
  const existing = persistentProcesses.get(skillId);
  if (existing) return existing;

  const info = findPersistentPythonSkillInfo(skillId);
  if (!info) return null;

  const skillPath = resolveInside(SKILLS_DIR, info.file);
  const procInfo = createPersistentAnalyzer(skillPath, skillId);
  const entry = { procInfo, disposed: false };
  persistentProcesses.set(skillId, entry);
  return entry;
}

async function executeSkillAction(skillId, action, payload = {}) {
  ensureEnabledSkillsLoaded();
  const pEntry = ensurePersistentActionProcess(skillId);
  if (!pEntry || !pEntry.procInfo || pEntry.failed) {
    throw new Error(`Skill ${skillId} is not running or not persistent.`);
  }
  // Pass action and payload directly as context, with empty image
  return await pEntry.procInfo.analyze('', { action, ...payload });
}

// ==========================================
// 公共 API
// ==========================================

/**
 * 切换技能启用/禁用
 */
function toggleSkill(skillId, enabled) {
  const all = getAvailableSkills();
  const found = all.find(p => p.id === skillId);
  if (!found) throw new Error(`未找到技能 "${skillId}"`);

  enabledState[skillId] = enabled;
  saveState();

  if (enabled) {
    try {
      const module = loadSkillModule(found);
      loadedSkills.set(skillId, { module, info: found });
      console.log(`[技能] 已启用: ${found.label}`);
    } catch (e) {
      throw new Error(`启用 ${found.label} 失败: ${e.message}`);
    }
  } else {
    // 清理持久进程
    if (persistentProcesses.has(skillId)) {
      const pEntry = persistentProcesses.get(skillId);
      if (pEntry.procInfo) pEntry.procInfo.dispose();
      persistentProcesses.delete(skillId);
    }
    loadedSkills.delete(skillId);
    console.log(`[技能] 已禁用: ${found.label}`);
  }

  return { ...found, enabled };
}

/**
 * 安装外部技能文件到 skills 目录
 */
function installSkill(sourcePath) {
  const sourceFullPath = path.resolve(String(sourcePath || ''));
  if (!fs.existsSync(sourceFullPath) || !fs.statSync(sourceFullPath).isFile()) {
    throw new Error(`文件不存在: ${sourcePath}`);
  }

  const destName = validateInstallFileName(path.basename(sourceFullPath));
  const destPath = resolveSkillDestination(destName);

  // 检查是否已存在同名文件
  if (fs.existsSync(destPath)) {
    throw new Error(`技能文件 ${destName} 已存在`);
  }

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  fs.copyFileSync(sourceFullPath, destPath);
  console.log(`[技能] 已安装: ${destName}`);

  const content = fs.readFileSync(destPath, 'utf-8');
  const added = parseInstalledSkillInfo(destName, content);
  // 安装不等于启用：不要在 installSkill 内 load/require 新技能。
  markInstalledSkillDisabled(added);
  return added;
}

/**
 * 安装技能（从内容字符串创建文件）
 */
function installSkillFromContent(fileName, content) {
  const destName = validateInstallFileName(fileName);

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const destPath = resolveSkillDestination(destName);
  if (fs.existsSync(destPath)) {
    throw new Error(`技能文件 ${destName} 已存在`);
  }

  fs.writeFileSync(destPath, content, 'utf-8');

  const added = parseInstalledSkillInfo(destName, content);
  // 安装不等于启用：不要在 installSkillFromContent 内 load/require 新技能。
  markInstalledSkillDisabled(added);
  console.log(`[技能] 已安装但未启用: ${added.label}`);
  return added;
}

/**
 * 批量分析：运行所有已启用技能，聚合结果
 *
 * 【重要】所有技能并行执行（Promise.all），互不阻塞。
 * 慢技能（如 Qwen API）不会拖累快技能（如 YOLO 本地推理）。
 */
async function analyzeAll(base64Image, context = {}) {
  ensureEnabledSkillsLoaded();

  // 收集所有待执行的技能
  const tasks = [];
  for (const [id, entry] of loadedSkills) {
    if (!isEnabled(id)) continue;
    tasks.push({ id, entry });
  }

  // 并行执行所有技能，互不等待
  const settled = await Promise.allSettled(
    tasks.map(async ({ id, entry }) => {
      const start = Date.now();
      const result = await entry.module.analyze(base64Image, context);
      return {
        skillId: id,
        skillLabel: entry.info.label,
        result,
        timeMs: Date.now() - start,
      };
    })
  );

  const results = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      const { id, entry } = tasks[i];
      console.error(`[技能] ${entry.info.label} 分析失败:`, s.reason?.message || s.reason);
      results.push({
        skillId: id,
        skillLabel: entry.info.label,
        error: s.reason?.message || String(s.reason),
      });
    }
  }

  if (results.length === 0) {
    return {
      text: '没有启用的技能',
      alert: false,
      alert_details: [],
      voice_reminder: false,
      voice_text: '',
      voice_texts: [],
      risk_level: 'none',
      cleanup_hint: '',
      evacuate_reminder: false,
      evacuate_text: '',
      beep_count: 0,
      _skillResults: [],
    };
  }

  // 聚合结果
  const textParts = [];
  const allAlertDetails = new Set();
  const allVoiceTextsSet = new Set();
  let isAlert = false;
  let voiceReminder = false;
  let maxRisk = 'none';
  let evacuateReminder = false;
  const cleanupHints = [];
  let evacuateText = '';
  let maxBeepCount = 0;
  // Qwen 破损独立字段
  let damageVoiceText = '';
  const damageAlertDetails = new Set();
  let damageBeepCount = 0;
  const alerts = [];
  const detections = [];

  for (const r of results) {
    if (r.error) {
      textParts.push(`[${r.skillLabel}] 错误: ${r.error}`);
      continue;
    }
    const res = r.result;
    textParts.push(`[${r.skillLabel}] ${res.text || ''}`);
    if (res.alert) isAlert = true;
    if (res.alert_details) res.alert_details.forEach(d => allAlertDetails.add(d));
    if (res.voice_reminder) voiceReminder = true;
    if (res.voice_texts) res.voice_texts.forEach(v => allVoiceTextsSet.add(v));
    if (RISK_WEIGHT[res.risk_level] > RISK_WEIGHT[maxRisk]) maxRisk = res.risk_level;
    if (res.cleanup_hint) cleanupHints.push(res.cleanup_hint);
    if (res.evacuate_reminder) {
      evacuateReminder = true;
      if (res.evacuate_text) evacuateText = res.evacuate_text;
    }
    if (res.beep_count) {
      if (res.beep_count === -1) maxBeepCount = -1;
      else if (maxBeepCount !== -1 && res.beep_count > maxBeepCount) maxBeepCount = res.beep_count;
    }
    // 聚合 Qwen 破损字段
    if (res.damage_voice_text) damageVoiceText = res.damage_voice_text;
    if (res.damage_alert_details) res.damage_alert_details.forEach(d => damageAlertDetails.add(d));
    if (res.damage_beep_count) {
      if (res.damage_beep_count === -1) damageBeepCount = -1;
      else if (damageBeepCount !== -1 && res.damage_beep_count > damageBeepCount) damageBeepCount = res.damage_beep_count;
    }
    if (Array.isArray(res.alerts)) {
      for (const alert of res.alerts) {
        alerts.push({ ...alert, skill: res.skill || r.skillId });
      }
    }
    if (Array.isArray(res.detections)) {
      for (const detection of res.detections) {
        detections.push({ ...detection, skill: res.skill || r.skillId });
      }
    }
  }

  const allVoiceTextsArr = [...allVoiceTextsSet];

  return {
    text: textParts.join('\n'),
    alert: isAlert,
    alert_details: [...allAlertDetails],
    voice_reminder: voiceReminder,
    voice_text: allVoiceTextsArr.join('，'),
    voice_texts: allVoiceTextsArr,
    risk_level: maxRisk,
    cleanup_hint: [...new Set(cleanupHints)].join('；'),
    evacuate_reminder: evacuateReminder,
    evacuate_text: evacuateText,
    beep_count: maxBeepCount,
    damage_voice_text: damageVoiceText,
    damage_alert_details: [...damageAlertDetails],
    damage_beep_count: damageBeepCount,
    alerts,
    detections,
    _skillResults: results,
  };
}

/**
 * 获取已启用技能列表（含状态）
 */
function getSkillsStatus() {
  const all = getAvailableSkills();
  ensureEnabledSkillsLoaded();
  return all.map(p => ({
    ...p,
    enabled: isEnabled(p.id),
    loaded: loadedSkills.has(p.id),
    failed: failedSkills.has(p.id),
    failReason: failedSkills.get(p.id) || '',
  }));
}

/**
 * 获取加载失败的技能列表（供 server.js / Electron 弹窗提示）
 */
function getFailedSkills() {
  return Array.from(failedSkills.entries()).map(([id, reason]) => ({
    id,
    label: loadedSkills.has(id) ? loadedSkills.get(id).info.label : id,
    reason,
  }));
}

/**
 * 获取单个已启用技能 (向后兼容)
 */
function getActiveSkill() {
  ensureEnabledSkillsLoaded();
  const first = loadedSkills.values().next();
  return first.done ? null : first.value.module;
}

function getActiveSkillInfo() {
  ensureEnabledSkillsLoaded();
  const first = loadedSkills.entries().next();
  if (first.done) return null;
  const [, entry] = first.value;
  return {
    id: entry.info.id,
    label: entry.info.label,
    description: entry.info.description,
  };
}

// ==========================================
// 初始化
// ==========================================
loadState();

// 进程退出时清理所有持久子进程
process.on('exit', () => shutdownPersistent());
process.on('SIGINT', () => { shutdownPersistent(); process.exit(); });
process.on('SIGTERM', () => { shutdownPersistent(); process.exit(); });

module.exports = {
  executeSkillAction,
  getAvailableSkills,
  getSkillsStatus,
  toggleSkill,
  installSkill,
  installSkillFromContent,
  analyzeAll,
  getActiveSkill,
  getActiveSkillInfo,
  shutdownPersistent,
  getFailedSkills,
};
