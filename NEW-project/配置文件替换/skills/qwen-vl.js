/**
 * AI 识别技能 - Qwen-VL (全景检测: 火灾/烟雾/杂物堆积)
 * 接口: { name: string, analyze(base64Image: string): Promise<AnalysisResult> }
 * 安全帽/背心检测已移交 yolo-safety 技能
 */
require('dotenv').config();
const axios = require('axios');

const getDashScopeApiKey = () => process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
const QWEN_MODEL = process.env.QWEN_MODEL || process.env.DASHSCOPE_MODEL || 'qwen-vl-plus';

const ANALYSIS_PROMPT = `分析图片中的安全情况。严格按以下格式逐条回复：

【火灾/烟雾】
存在就说明，如果是在指定的焚烧区域（焚烧炉/焚烧区/焚烧点）内，请明确标注"焚烧区域"。不存在就写"无"。

【杂物堆积】
存在就说明并指出杂物类型（垃圾/塑料/金属/木材等），不存在就写"无"。

铁律：
- 禁止使用"但是"、"不过"、"虽然"、"然而"等转折/削弱词
- 风险就是风险，不要自行"减轻"
- 没有风险就写"无"，不要凭空捏造
- 不确定的情况不报警`;

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

// ==========================================
// 安全风险检测
// ==========================================
const NEGATIVE_PREFIXES = ["无", "没有", "不存在", "未发现", "未出现", "未", "没", "不", "并未", "并无"];

const INCINERATION_ZONE_KEYWORDS = ["焚烧区域", "焚烧炉", "焚烧区", "焚烧点", "指定焚烧", "焚烧处理区"];

const ENV_ALERT_PATTERNS = [
  ["发生火灾", "发生火灾"],
  ["着火", "发生火灾/着火"],
  ["明火", "存在明火"],
  ["浓烟", "存在浓烟"],
  ["烟雾", "存在烟雾"],
  ["火情", "存在火情"],
  ["火焰", "存在火焰"],
  ["杂物堆积", "存在杂物堆积"],
];

const DEBRIS_HIGH_RISK = ["金属", "铁", "钢", "玻璃", "易燃", "化学品", "尖锐", "重物", "石块", "砖块", "油桶", "气瓶"];
const DEBRIS_MEDIUM_RISK = ["木材", "木板", "纸箱", "电缆", "电线", "工具", "管材", "建材"];

function isInSectionHeader(text, idx) {
  const before = text.lastIndexOf('【', idx);
  if (before < 0) return false;
  const after = text.indexOf('】', before);
  return after >= 0 && idx > before && idx < after;
}

function isRealRisk(text, riskIdx, windowSize = 20) {
  const prefixStart = Math.max(0, riskIdx - windowSize);
  const prefix = text.slice(prefixStart, riskIdx);
  for (const neg of NEGATIVE_PREFIXES) {
    if (prefix.endsWith(neg)) return false;
  }
  return true;
}

const POSTFIX_NEGATIVES = ["无风险", "未发现", "未出现", "正常", "无异常", "不存在", "：无", ": 无", "\n无", "安全", "良好", "无问题", "未见"];
function checkPostfixNegation(text, riskIdx, patternLen) {
  const postfixEnd = Math.min(text.length, riskIdx + patternLen + 8);
  const postfix = text.slice(riskIdx, postfixEnd);
  return POSTFIX_NEGATIVES.some(neg => postfix.includes(neg));
}

function classifyDebrisLevel(text) {
  const t = text.toLowerCase();
  for (const kw of DEBRIS_HIGH_RISK) {
    if (t.includes(kw)) return "high";
  }
  for (const kw of DEBRIS_MEDIUM_RISK) {
    if (t.includes(kw)) return "medium";
  }
  return "low";
}

function checkSafetyRisk(text) {
  const textLower = text.toLowerCase();
  const detected = [];
  const voiceList = [];
  let maxRiskLevel = "none";
  let cleanupHint = "";
  let fireDetected = false;
  let beepCount = 0;
  let isIncinerationZone = false;

  for (const kw of INCINERATION_ZONE_KEYWORDS) {
    const idx = textLower.indexOf(kw);
    if (idx >= 0 && isRealRisk(textLower, idx)) {
      isIncinerationZone = true;
      break;
    }
  }

  for (const [pattern, desc] of ENV_ALERT_PATTERNS) {
    const idx = textLower.indexOf(pattern);
    if (idx >= 0 && !isInSectionHeader(textLower, idx) && isRealRisk(textLower, idx) && !checkPostfixNegation(textLower, idx, pattern.length)) {
      if (desc.includes("杂物堆积")) {
        const level = classifyDebrisLevel(textLower);
        if (level === "high") {
          voiceList.push({ text: "旁边有堆积物，高危物品，请尽快清理", level: 3 });
          maxRiskLevel = "high";
          cleanupHint = "请尽快清理";
        } else if (level === "medium") {
          voiceList.push({ text: "旁边有堆积物，中危物品，建议尽快清理", level: 2 });
          if (maxRiskLevel !== "high") maxRiskLevel = "medium";
          cleanupHint = "建议尽快清理";
        } else {
          voiceList.push({ text: "旁边有堆积物", level: 1 });
          if (maxRiskLevel === "none") maxRiskLevel = "low";
        }
      } else {
        if ((desc.includes("火灾") || desc.includes("明火") || desc.includes("火焰") || desc.includes("浓烟") || desc.includes("烟雾") || desc.includes("火情")) && isIncinerationZone) {
          continue;
        }
        detected.push(desc);
        let vLevel = 3;
        if (desc.includes("火灾") || desc.includes("明火") || desc.includes("火焰") || desc.includes("浓烟") || desc.includes("烟雾") || desc.includes("火情")) {
          vLevel = 4;
          maxRiskLevel = "high";
          fireDetected = true;
          beepCount = -1;
        } else if (maxRiskLevel === "none") {
          maxRiskLevel = "medium";
        }
        voiceList.push({ text: desc, level: vLevel });
      }
    }
  }

  let voiceTexts = [];
  if (voiceList.length > 0) {
    const maxLevel = Math.max(...voiceList.map(v => v.level));
    voiceTexts = voiceList.filter(v => v.level === maxLevel).map(v => v.text);
  }

  const evacuate = fireDetected;
  const evacuateText = fireDetected ? "请尽快离开" : "";
  return {
    hasRisk: detected.length > 0,
    categories: [...new Set(detected)],
    voiceReminder: voiceTexts.length > 0 || evacuate,
    voiceText: voiceTexts.join("，"),
    voiceTexts,
    riskLevel: maxRiskLevel,
    cleanupHint,
    evacuateReminder: evacuate,
    evacuateText,
    beepCount
  };
}

// ==========================================
// 异步缓存层：Qwen API 调用不阻塞主循环
// ==========================================
let _cachedResult = null;      // 上次成功结果
let _lastFetchTime = 0;        // 上次请求时间
let _pendingPromise = null;    // 正在飞中的请求
const CACHE_TTL = 3500;        // 缓存有效期 3.5 秒（略大于 1 秒分析间隔）

async function fetchQwenResult(base64Image) {
  const apiKey = getDashScopeApiKey();
  if (!apiKey) {
    throw new Error('Qwen API key is missing. Please set QWEN_API_KEY or DASHSCOPE_API_KEY.');
  }

  const imgUrl = `data:image/jpeg;base64,${base64Image}`;
  const payload = {
    model: QWEN_MODEL,
    input: {
      messages: [{
        role: "user",
        content: [
          { image: imgUrl },
          { text: ANALYSIS_PROMPT }
        ]
      }]
    }
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const resp = await axios.post(DASHSCOPE_URL, payload, { headers, timeout: 30000 });
  const data = resp.data;
  if (resp.status !== 200 || !data.output) {
    throw new Error(`分析失败: HTTP ${resp.status}`);
  }

  const choices = data.output.choices || [];
  const content = choices[0]?.message?.content || [];
  const resultText = content[0]?.text || '分析返回为空';

  const { hasRisk, categories, voiceReminder, voiceText, voiceTexts, riskLevel, cleanupHint, evacuateReminder, evacuateText, beepCount } = checkSafetyRisk(resultText);

  return {
    text: resultText,
    alert: hasRisk,
    alert_details: categories,
    voice_reminder: voiceReminder,
    voice_text: voiceText,
    voice_texts: voiceTexts,
    risk_level: riskLevel,
    cleanup_hint: cleanupHint,
    evacuate_reminder: evacuateReminder,
    evacuate_text: evacuateText,
    beep_count: beepCount
  };
}

// 后台刷新缓存（不 await，让它自己飞）
function backgroundRefresh(base64Image) {
  if (_pendingPromise) return;  // 已有请求在飞，不重复发起

  _pendingPromise = fetchQwenResult(base64Image)
    .then(res => {
      _cachedResult = res;
      _lastFetchTime = Date.now();
      _pendingPromise = null;
      return res;
    })
    .catch(err => {
      console.error('[qwen-vl] 后台刷新失败:', err.message);
      _pendingPromise = null;
    });
}

// ==========================================
// 技能导出
// ==========================================
module.exports = {
  name: 'qwen-vl',
  label: '阿里多模态 (全景)',
  description: '阿里云多模态大模型，检测火灾/烟雾/杂物堆积（异步缓存，不阻塞）',

  async analyze(base64Image) {
    const now = Date.now();

    // 1. 缓存新鲜 → 直接返回（< 1ms）
    if (_cachedResult && (now - _lastFetchTime) < CACHE_TTL) {
      // 顺便在后台偷偷刷新（如果快过期了）
      if ((now - _lastFetchTime) > CACHE_TTL - 1000 && !_pendingPromise) {
        backgroundRefresh(base64Image);
      }
      return _cachedResult;
    }

    // 2. 有请求在飞 → 返回旧缓存（或等待，如果这是首次）
    if (_pendingPromise) {
      // 如果有旧缓存，先返回旧的，不让主循环阻塞
      if (_cachedResult) return _cachedResult;
      // 首次且无缓存，只能等（最多等 30 秒超时）
      return _pendingPromise;
    }

    // 3. 缓存过期且没有在飞的请求 → 发起新请求并等待
    const result = await fetchQwenResult(base64Image);
    _cachedResult = result;
    _lastFetchTime = now;
    return result;
  }
};
