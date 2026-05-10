/**
 * 开发模式一键启动脚本
 * 用法:
 *   node dev.js            启动后端 + nginx + 自动打开浏览器
 *   node dev.js --electron 启动后端 + nginx + Electron（测试桌面端）
 *
 * 改完代码直接运行此脚本，无需打包。
 * 按 Ctrl+C 一键关闭所有服务。
 */

require('dotenv').config({ quiet: true });

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

const { findAvailablePort } = require('./src/port-utils');

// ==========================================
// 参数
// ==========================================
const args = process.argv.slice(2);
const withElectron = args.includes('--electron');

// ==========================================
// 配置
// ==========================================
const NODE_PORT = Number(process.env.NODE_PORT || process.env.PORT || 8082);
const NGINX_PORT = Number(process.env.NGINX_PORT || 8443);

const ROOT_DIR = __dirname;
const LOG_DIR = path.join(ROOT_DIR, 'logs');

const NGINX_DIR = path.join(ROOT_DIR, 'nginx');
const NGINX_BIN = path.join(NGINX_DIR, 'bin', (() => {
  const map = {
    win32: 'nginx-win.exe',
    darwin: 'nginx-mac',
    linux: 'nginx-linux'
  };

  return map[process.platform] || 'nginx-linux';
})());

const NGINX_CONF_TEMPLATE = path.join(NGINX_DIR, 'conf', 'nginx.conf');
const NGINX_TEMP_CONF = path.join(NGINX_DIR, 'conf', 'nginx-temp.conf');

let currentNginxConfPath = NGINX_TEMP_CONF;

// ==========================================
// 工具函数
// ==========================================
function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} 不存在: ${filePath}`);
  }
}

function commandName(name) {
  if (process.platform === 'win32') {
    return `${name}.cmd`;
  }

  return name;
}

function ensureNginxRuntimeDirs() {
  const dirs = [
    'logs',
    'temp',
    'temp/client_body_temp',
    'temp/proxy_temp',
    'temp/fastcgi_temp',
    'temp/uwsgi_temp',
    'temp/scgi_temp'
  ];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(NGINX_DIR, dir), { recursive: true });
  }
}

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || [];

    for (const iface of list) {
      if (
        iface &&
        iface.family === 'IPv4' &&
        !iface.internal &&
        !iface.address.startsWith('127.')
      ) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

function openBrowser(url) {
  let command;
  let openArgs;

  if (process.platform === 'win32') {
    command = 'cmd';
    openArgs = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    openArgs = [url];
  } else {
    command = 'xdg-open';
    openArgs = [url];
  }

  const child = spawn(command, openArgs, {
    stdio: 'ignore',
    windowsHide: true,
    detached: true
  });

  child.on('error', (err) => {
    log(`自动打开浏览器失败: ${err.message}`);
    log(`请手动打开: ${url}`);
  });

  child.unref();
}

function requestUrl(url, timeoutMs = 1500) {
  return new Promise(resolve => {
    const client = url.startsWith('https:') ? https : http;
    let finished = false;

    function done(value) {
      if (finished) return;
      finished = true;
      resolve(value);
    }

    const req = client.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false
      },
      (res) => {
        res.resume();

        // 2xx/3xx/4xx 都说明服务已经响应。
        // 5xx 通常说明服务还没准备好或内部错误。
        done(res.statusCode >= 200 && res.statusCode < 500);
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });

    req.on('error', () => {
      done(false);
    });

    req.end();
  });
}

async function waitForAnyUrl(urls, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const lastUrls = urls.join(', ');

  while (Date.now() < deadline) {
    for (const url of urls) {
      const ok = await requestUrl(url);

      if (ok) {
        log(`${label} 已就绪: ${url}`);
        return url;
      }
    }

    await sleep(500);
  }

  throw new Error(`${label} 未在 ${timeoutMs}ms 内就绪，检测地址: ${lastUrls}`);
}

function ensureDaemonOff(conf) {
  // 已经明确写了 daemon，就强制改成 off。
  if (/^\s*daemon\s+\w+\s*;/m.test(conf)) {
    return conf.replace(/^\s*daemon\s+\w+\s*;/m, 'daemon off;');
  }

  // 优先插入到 worker_processes 后面。
  if (/^\s*worker_processes\s+[^;]+;/m.test(conf)) {
    return conf.replace(
      /^(\s*worker_processes\s+[^;]+;\s*)/m,
      `$1\ndaemon off;\n`
    );
  }

  // 没有 worker_processes，就放文件最前面。
  return `daemon off;\n${conf}`;
}

function buildNginxConf(template, actualNodePort, actualNginxPort) {
  let conf = template;

  // 推荐以后在 nginx.conf 里使用占位符，最稳定。
  if (conf.includes('__NODE_PORT__') || conf.includes('__NGINX_PORT__')) {
    conf = conf
      .replace(/__NODE_PORT__/g, String(actualNodePort))
      .replace(/__NGINX_PORT__/g, String(actualNginxPort));

    return ensureDaemonOff(conf);
  }

  // 兼容旧配置：替换 listen 端口。
  conf = conf.replace(
    /listen\s+\d+\s+ssl;/g,
    `listen ${actualNginxPort} ssl;`
  );

  // 兼容 proxy_pass http(s)://127.0.0.1:xxxx
  conf = conf.replace(
    /(proxy_pass\s+)https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g,
    `$1https://127.0.0.1:${actualNodePort}`
  );

  // 兼容直接写死的后端 API 地址。
  conf = conf
    .replace(
      /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/events/g,
      `https://127.0.0.1:${actualNodePort}/api/events`
    )
    .replace(
      /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\//g,
      `https://127.0.0.1:${actualNodePort}/api/`
    )
    .replace(
      /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/offer/g,
      `https://127.0.0.1:${actualNodePort}/offer`
    );

  return ensureDaemonOff(conf);
}

function runNginxConfigTest(confPath) {
  const result = spawnSync(
    NGINX_BIN,
    ['-p', NGINX_DIR, '-c', confPath, '-t'],
    {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 8000
    }
  );

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.error) {
    throw new Error(`nginx 配置测试无法启动: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`nginx 配置测试失败:\n${output}`);
  }

  return output;
}

function stopNginxByCommand(signal = 'quit') {
  try {
    let confPath = currentNginxConfPath;

    if (!fs.existsSync(confPath)) {
      confPath = NGINX_CONF_TEMPLATE;
    }

    if (!fs.existsSync(NGINX_BIN) || !fs.existsSync(confPath)) {
      return {
        ok: false,
        skipped: true,
        output: ''
      };
    }

    const result = spawnSync(
      NGINX_BIN,
      ['-p', NGINX_DIR, '-c', confPath, '-s', signal],
      {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 5000
      }
    );

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

    return {
      ok: result.status === 0,
      skipped: false,
      status: result.status,
      output
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message,
      output: ''
    };
  }
}

function stopProjectNginxGracefully() {
  const quitResult = stopNginxByCommand('quit');

  if (quitResult && quitResult.ok) {
    return true;
  }

  const stopResult = stopNginxByCommand('stop');

  return Boolean(stopResult && stopResult.ok);
}

// ==========================================
// 进程管理
// ==========================================
const processes = [];
let cleaningUp = false;

function register(proc, name, options = {}) {
  const {
    critical = true,
    allowCleanExit = false
  } = options;

  processes.push({ proc, name });

  proc.on('error', (err) => {
    log(`${name} 启动失败: ${err.message}`);

    if (!cleaningUp && critical) {
      cleanup(1);
    }
  });

  proc.on('exit', (code, signal) => {
    const idx = processes.findIndex(p => p.proc === proc);

    if (idx >= 0) {
      processes.splice(idx, 1);
    }

    const exitText = signal ? `signal=${signal}` : `code=${code}`;
    log(`${name} 已退出 (${exitText})`);

    if (cleaningUp || !critical) return;

    const cleanExit = code === 0 || signal === 'SIGINT' || signal === 'SIGTERM';

    if (!allowCleanExit || !cleanExit) {
      log(`${name} 异常退出，开始关闭其他服务...`);
      cleanup(1);
    }
  });
}

function killProcessTree(proc, name) {
  try {
    if (!proc || proc.killed || !proc.pid) return;

    try {
      proc.kill('SIGTERM');
    } catch (_) {}

    if (process.platform === 'win32') {
      spawnSync(
        'taskkill',
        ['/T', '/F', '/PID', String(proc.pid)],
        {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 5000
        }
      );
    }

    log(`已请求关闭 ${name} (pid=${proc.pid})`);
  } catch (e) {
    log(`关闭 ${name} 失败: ${e.message}`);
  }
}

function cleanup(exitCode = 0) {
  if (cleaningUp) return;

  cleaningUp = true;
  log('正在关闭所有服务...');

  // 先让 nginx 按自己的 pid 文件优雅退出。
  stopProjectNginxGracefully();

  // 再兜底杀当前脚本登记过的子进程。
  for (const { proc, name } of [...processes]) {
    killProcessTree(proc, name);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 800);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err && err.stack ? err.stack : err);
  cleanup(1);
});

process.on('unhandledRejection', (err) => {
  console.error('未处理 Promise 异常:', err && err.stack ? err.stack : err);
  cleanup(1);
});

// ==========================================
// 启动流程
// ==========================================
async function main() {
  log('============================================');
  log('真視眼 CYPHER - 开发模式启动');
  log('============================================');

  fs.mkdirSync(LOG_DIR, { recursive: true });
  ensureNginxRuntimeDirs();

  // 0. 基础文件检查
  log('[0/5] 检查项目文件...');

  assertFileExists(path.join(ROOT_DIR, 'src', 'server.js'), 'Node.js 后端入口');
  assertFileExists(NGINX_CONF_TEMPLATE, 'nginx 配置文件');
  assertFileExists(NGINX_BIN, 'nginx 可执行文件');

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(NGINX_BIN, 0o755);
    } catch (e) {
      log(`设置 nginx 可执行权限失败，可手动 chmod +x: ${e.message}`);
    }
  }

  // 启动前先尝试清理上一次本项目残留的 nginx。
  // 只按当前项目的 nginx pid/config 停，不全局 taskkill，避免误杀其他项目 nginx。
  log('[0/5] 清理上一次可能残留的本项目 nginx...');
  stopProjectNginxGracefully();

  // 1. 检测端口
  log('[1/5] 检测端口...');

  let actualNodePort;
  let actualNginxPort;

  try {
    actualNodePort = await findAvailablePort(NODE_PORT);
    actualNginxPort = await findAvailablePort(NGINX_PORT);

    log(`  Node.js 端口: ${actualNodePort}`);
    log(`  nginx 端口: ${actualNginxPort}`);
  } catch (e) {
    throw new Error(`端口检测失败: ${e.message}`);
  }

  // 2. 生成 nginx 临时配置，并先执行 nginx -t
  log('[2/5] 生成并测试 nginx 配置...');

  const nginxConfTemplate = fs.readFileSync(NGINX_CONF_TEMPLATE, 'utf-8');
  const nginxConf = buildNginxConf(
    nginxConfTemplate,
    actualNodePort,
    actualNginxPort
  );

  currentNginxConfPath = NGINX_TEMP_CONF;
  fs.writeFileSync(currentNginxConfPath, nginxConf, 'utf-8');

  const nginxTestOutput = runNginxConfigTest(currentNginxConfPath);

  if (nginxTestOutput) {
    log(nginxTestOutput);
  }

  // 3. 启动 Node.js 后端
  log('[3/5] 启动 Node.js 后端...');

  const server = spawn(
    'node',
    ['src/server.js'],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        LOG_DIR,
        ELECTRON_RUN: '1',
        PORT: String(actualNodePort),
        NODE_PORT: String(actualNodePort)
      },
      windowsHide: true
    }
  );

  register(server, 'Node.js 后端', {
    critical: true,
    allowCleanExit: false
  });

  await waitForAnyUrl(
    [
      `https://127.0.0.1:${actualNodePort}/api/info`,
      `https://127.0.0.1:${actualNodePort}/`
    ],
    'Node.js 后端',
    20000
  );

  // 4. 启动 nginx
  log('[4/5] 启动 nginx...');

  const nginx = spawn(
    NGINX_BIN,
    ['-p', NGINX_DIR, '-c', currentNginxConfPath],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      windowsHide: true
    }
  );

  // 因为临时配置已强制 daemon off，所以 nginx 会保持在这个子进程中。
  // 如果它自己退出，通常代表异常。
  register(nginx, 'nginx', {
    critical: true,
    allowCleanExit: false
  });

  await waitForAnyUrl(
    [
      `https://127.0.0.1:${actualNginxPort}/dashboard`,
      `https://127.0.0.1:${actualNginxPort}/`
    ],
    'nginx 前端',
    20000
  );

  const lanIp = getLanIp();

  // 5. 启动 Electron 或打开浏览器
  if (withElectron) {
    log('[5/5] 启动 Electron...');

    const electron = spawn(
      commandName('npx'),
      ['electron', '.'],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env: {
          ...process.env,
          NGINX_PORT: String(actualNginxPort),
          NODE_PORT: String(actualNodePort)
        },
        windowsHide: true
      }
    );

    register(electron, 'Electron', {
      critical: false,
      allowCleanExit: true
    });
  } else {
    log('[5/5] 打开浏览器...');

    const url = `https://127.0.0.1:${actualNginxPort}/dashboard`;
    openBrowser(url);
  }

  // 输出访问地址
  log('============================================');
  log('所有服务已启动！');
  log('');
  log('【本机调试】');
  log(`  https://127.0.0.1:${actualNodePort}/             (Node.js 直接访问)`);
  log(`  https://127.0.0.1:${actualNginxPort}/            (nginx 前端)`);
  log(`  https://127.0.0.1:${actualNginxPort}/dashboard   (主界面)`);
  log(`  https://127.0.0.1:${actualNginxPort}/monitor     (兼容入口)`);
  log('');
  log('【局域网访问 - 手机/其他电脑】');
  log(`  https://${lanIp}:${actualNginxPort}/             (手机推流)`);
  log(`  https://${lanIp}:${actualNginxPort}/dashboard    (主界面)`);
  log('');
  log('按 Ctrl+C 关闭所有服务');
  log('============================================');
}

main().catch(err => {
  console.error('启动失败:', err && err.stack ? err.stack : err);
  cleanup(1);
});
