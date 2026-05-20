require('dotenv').config({ quiet: true });

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { spawn, fork, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

const { findAvailablePort } = require('./src/port-utils');

// ==========================================
// 全局状态
// ==========================================
let mainWindow;
let nodeProcess = null;
let nginxProcess = null;
let isServicesRunning = false;
let servicesManagedByThisProcess = false;
let stoppingServices = false;

let actualNodePort = Number(process.env.NODE_PORT || process.env.PORT || 8082);
let actualNginxPort = Number(process.env.NGINX_PORT || 8443);

const managedChildren = new Set();

let LOG_DIR;
let SERVER_LOG;

// ==========================================
// Electron 启动参数
// ==========================================
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('ignore-connections-limit', '127.0.0.1');

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (
    url.startsWith('https://127.0.0.1') ||
    url.startsWith('https://localhost')
  ) {
    event.preventDefault();
    callback(true);
    return;
  }

  callback(false);
});

// ==========================================
// 日志
// ==========================================
function initLogDir() {
  if (LOG_DIR) return;

  LOG_DIR = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'logs')
    : path.join(app.getPath('userData'), 'logs');

  SERVER_LOG = path.join(LOG_DIR, 'main.log');
}

function ensureLogDir() {
  try {
    initLogDir();
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {}
}

function logToFile(tag, message) {
  try {
    ensureLogDir();
    const time = new Date().toISOString();
    fs.appendFileSync(SERVER_LOG, `[${time}] [${tag}] ${message}\n`, 'utf-8');
  } catch (e) {
    console.error('logToFile error:', e.message);
  }
}

function trackChild(child) {
  if (child && child.pid) {
    managedChildren.add(child);

    const untrack = () => managedChildren.delete(child);

    child.once('exit', untrack);
    child.once('close', untrack);
  }

  return child;
}

// ==========================================
// 工具函数
// ==========================================
function getLanIp() {
  const ips = [];
  const virtualKeywords = [
    'vmware',
    'virtualbox',
    'docker',
    'vpn',
    'tun',
    'tap',
    'ppp',
    'mihomo',
    'veth',
    'hyper-v'
  ];

  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = virtualKeywords.some(v => lowerName.includes(v));

    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4') continue;
      if (iface.internal) continue;
      if (isVirtual) continue;
      if (iface.address.startsWith('169.254.')) continue;
      if (iface.address.startsWith('198.18.') || iface.address.startsWith('198.19.')) continue;

      ips.push(iface.address);
    }
  }

  return ips.length > 0 ? ips[0] : '127.0.0.1';
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getNginxPlatformBinary() {
  const map = {
    win32: 'nginx-win.exe',
    darwin: 'nginx-mac',
    linux: 'nginx-linux'
  };

  return map[process.platform] || 'nginx-linux';
}

function getNginxSourceDir() {
  return !app.isPackaged
    ? path.join(__dirname, 'nginx')
    : path.join(process.resourcesPath, 'nginx-runtime');
}

function getNginxRuntimeDir() {
  return path.join(app.getPath('userData'), 'nginx-runtime');
}

function ensureNginxRuntime() {
  const source = getNginxSourceDir();
  const runtime = getNginxRuntimeDir();

  if (!fs.existsSync(source)) {
    throw new Error(`nginx 源目录不存在: ${source}`);
  }

  const nginxBin = path.join(runtime, 'bin', getNginxPlatformBinary());

  if (!fs.existsSync(runtime) || !fs.existsSync(nginxBin)) {
    copyDir(source, runtime);
  }

  const uiSource = path.join(__dirname, 'html');
  const uiDest = path.join(runtime, 'html');

  if (fs.existsSync(uiSource)) {
    fs.mkdirSync(uiDest, { recursive: true });

    const uiFiles = fs.readdirSync(uiSource, { withFileTypes: true });

    for (const entry of uiFiles) {
      const srcPath = path.join(uiSource, entry.name);
      const destPath = path.join(uiDest, entry.name);

      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  const certSource = path.join(__dirname, 'cert.pem');
  const keySource = path.join(__dirname, 'key.pem');
  const certDest = path.join(runtime, 'cert.pem');
  const keyDest = path.join(runtime, 'key.pem');

  if (fs.existsSync(certSource)) fs.copyFileSync(certSource, certDest);
  if (fs.existsSync(keySource)) fs.copyFileSync(keySource, keyDest);

  // Fallback: try nginx source directory if not found in project root
  if (!fs.existsSync(certDest)) {
    const nginxCertSource = path.join(source, 'cert.pem');
    if (fs.existsSync(nginxCertSource)) fs.copyFileSync(nginxCertSource, certDest);
  }
  if (!fs.existsSync(keyDest)) {
    const nginxKeySource = path.join(source, 'key.pem');
    if (fs.existsSync(nginxKeySource)) fs.copyFileSync(nginxKeySource, keyDest);
  }

  const temps = [
    'logs',
    'temp',
    'temp/client_body_temp',
    'temp/proxy_temp',
    'temp/fastcgi_temp',
    'temp/uwsgi_temp',
    'temp/scgi_temp'
  ];

  for (const t of temps) {
    fs.mkdirSync(path.join(runtime, t), { recursive: true });
  }

  return runtime;
}

function writeNginxConf(nginxDir, nodePort = 8082, nginxPort = 8443) {
  const confPath = path.join(nginxDir, 'conf', 'nginx.conf');
  const confDir = path.dirname(confPath);

  fs.mkdirSync(confDir, { recursive: true });

  const certPath = path.join(nginxDir, 'cert.pem').replace(/\\/g, '/');
  const keyPath = path.join(nginxDir, 'key.pem').replace(/\\/g, '/');
  const htmlPath = path.join(nginxDir, 'html').replace(/\\/g, '/');
  const tempPath = path.join(nginxDir, 'temp').replace(/\\/g, '/');
  const logsPath = path.join(nginxDir, 'logs').replace(/\\/g, '/');

  const conf = `worker_processes  1;
daemon off;
error_log "${logsPath}/error.log";
pid "${logsPath}/nginx.pid";

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;

    client_body_temp_path "${tempPath}/client_body_temp";
    proxy_temp_path "${tempPath}/proxy_temp";
    fastcgi_temp_path "${tempPath}/fastcgi_temp";
    uwsgi_temp_path "${tempPath}/uwsgi_temp";
    scgi_temp_path "${tempPath}/scgi_temp";

    server {
        listen       ${nginxPort} ssl;
        server_name  localhost;

        ssl_certificate      "${certPath}";
        ssl_certificate_key  "${keyPath}";
        ssl_session_cache    shared:SSL:1m;
        ssl_session_timeout  5m;
        ssl_ciphers  HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers  on;

        location / {
            root   "${htmlPath}";
            index  webrtc-client.html;
            try_files $uri $uri/ =404;
        }

        location /monitor {
            alias  "${htmlPath}/dashboard.html";
            default_type text/html;
        }

        location /test {
            alias  "${htmlPath}/test-capture.html";
            default_type text/html;
        }

        location /desktop {
            alias  "${htmlPath}/desktop-capture.html";
            default_type text/html;
        }

        location /recordings {
            alias  "${htmlPath}/recordings.html";
            default_type text/html;
        }

        location /events {
            alias  "${htmlPath}/events.html";
            default_type text/html;
        }

        location /settings {
            alias  "${htmlPath}/settings.html";
            default_type text/html;
        }

        location /dashboard {
            alias  "${htmlPath}/dashboard.html";
            default_type text/html;
        }

        location /api/events {
            proxy_pass https://127.0.0.1:${nodePort}/api/events;
            proxy_http_version 1.1;
            proxy_ssl_verify off;
            proxy_ssl_session_reuse off;
            proxy_buffering off;
            proxy_cache off;
            proxy_read_timeout 3600s;
            add_header X-Accel-Buffering no;
        }

        location /api/ {
            proxy_pass https://127.0.0.1:${nodePort}/api/;
            proxy_http_version 1.1;
            proxy_ssl_verify off;
        }

        location /offer {
            proxy_pass https://127.0.0.1:${nodePort}/offer;
            proxy_http_version 1.1;
            proxy_ssl_verify off;
        }
    }
}
`;

  fs.writeFileSync(confPath, conf, 'utf-8');
}

function waitForUrl(url, timeoutMs = 10000) {
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }

      const req = https.get(
        url,
        {
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (res) => {
          res.resume();

          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve(true);
          } else {
            setTimeout(check, 500);
          }
        }
      );

      req.on('error', () => {
        setTimeout(check, 500);
      });

      req.on('timeout', () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };

    check();
  });
}

async function waitForBackend(port, timeoutMs) {
  return waitForUrl(`https://127.0.0.1:${port}/api/info`, timeoutMs);
}

function testNginxConfig(nginxDir) {
  const nginxBin = path.join(nginxDir, 'bin', getNginxPlatformBinary());
  const confPath = path.join(nginxDir, 'conf', 'nginx.conf');

  const result = spawnSync(
    nginxBin,
    ['-p', nginxDir, '-c', confPath, '-t'],
    {
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true,
    }
  );

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.error) {
    throw new Error(`nginx 配置测试无法启动: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`nginx 配置测试失败:\n${output}`);
  }

  if (output) {
    logToFile('NGINX-TEST', output);
  }
}

function stopNginxByCommand(signal = 'quit') {
  try {
    const nginxDir = getNginxRuntimeDir();
    const nginxBin = path.join(nginxDir, 'bin', getNginxPlatformBinary());
    const confPath = path.join(nginxDir, 'conf', 'nginx.conf');

    if (!fs.existsSync(nginxBin) || !fs.existsSync(confPath)) {
      return {
        ok: false,
        skipped: true,
        output: ''
      };
    }

    const result = spawnSync(
      nginxBin,
      ['-p', nginxDir, '-c', confPath, '-s', signal],
      {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      }
    );

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

    logToFile('NGINX', `${signal} status=${result.status}, output=${output}`);

    return {
      ok: result.status === 0,
      skipped: false,
      status: result.status,
      output
    };
  } catch (e) {
    logToFile('NGINX', `${signal} failed: ${e.message}`);

    return {
      ok: false,
      skipped: false,
      error: e.message,
      output: ''
    };
  }
}

function stopNginxGracefully() {
  const quitResult = stopNginxByCommand('quit');

  if (quitResult && quitResult.ok) {
    return true;
  }

  const stopResult = stopNginxByCommand('stop');

  return Boolean(stopResult && stopResult.ok);
}

async function killProcess(proc, label, timeoutMs = 3000) {
  if (!proc) return;

  const pid = proc.pid;

  try {
    if (!proc.killed) {
      proc.kill();
    }
  } catch (_) {}

  await waitForProcessExit(proc, timeoutMs);

  if (pid && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
        windowsHide: true,
        timeout: 3000
      });

      console.log(`[清理] 已强制终止 ${label} PID ${pid}`);
    } catch (_) {}
  }
}

async function cleanupStartedServices() {
  if (nodeProcess) {
    const np = nodeProcess;
    nodeProcess = null;
    await killProcess(np, 'Node.js');
  }

  stopNginxGracefully();

  if (nginxProcess) {
    const np = nginxProcess;
    nginxProcess = null;
    await killProcess(np, 'nginx');
  }

  await cleanupManagedChildren();
}

// ==========================================
// 服务管理
// ==========================================
async function startServices(customNodePort, customNginxPort) {
  if (isServicesRunning) {
    return {
      success: true,
      lanIp: getLanIp(),
      nodePort: actualNodePort,
      nginxPort: actualNginxPort
    };
  }

  console.log('[端口] 检测可用端口...');

  try {
    const nodeStartPort = customNodePort
      ? parseInt(customNodePort, 10)
      : Number(process.env.NODE_PORT || process.env.PORT || 8082);

    const nginxStartPort = customNginxPort
      ? parseInt(customNginxPort, 10)
      : Number(process.env.NGINX_PORT || 8443);

    actualNodePort = await findAvailablePort(nodeStartPort);
    actualNginxPort = await findAvailablePort(nginxStartPort);

    console.log(`[端口] Node.js: ${actualNodePort}, nginx: ${actualNginxPort}`);
    logToFile('MAIN', `ports node=${actualNodePort}, nginx=${actualNginxPort}`);
  } catch (e) {
    console.error('[端口]', e.message);
    logToFile('MAIN', `port check failed: ${e.message}`);
    throw e;
  }

  try {
    // 1. 准备 nginx 运行时目录
    const nginxDir = ensureNginxRuntime();
    writeNginxConf(nginxDir, actualNodePort, actualNginxPort);
    testNginxConfig(nginxDir);

    // 2. 设置环境变量
    const settings = loadSettings();
    const isPackaged = app.isPackaged;

    const asarNodeModules = isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'node_modules')
      : null;

    const asarUnpackedNodeModules = isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
      : null;

    const nodePaths = [
      asarNodeModules,
      process.env.NODE_PATH,
      asarUnpackedNodeModules
    ].filter(Boolean).join(path.delimiter);

    const certPath = isPackaged
      ? path.join(process.resourcesPath, 'cert.pem')
      : path.join(__dirname, 'cert.pem');

    const keyPath = isPackaged
      ? path.join(process.resourcesPath, 'key.pem')
      : path.join(__dirname, 'key.pem');

    const htmlDirPath = isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'html')
      : path.join(__dirname, 'html');

    const env = {
      ...process.env,
      ELECTRON_RUN: '1',
      LOG_DIR,
      CORS_ORIGIN: '*',
      PORT: String(actualNodePort),
      NODE_PORT: String(actualNodePort),
      NGINX_PORT: String(actualNginxPort),
      PYTHON_PATH: settings.preferredPython || process.env.PYTHON_PATH || '',
      NODE_PATH: nodePaths,
      CERT_PATH: certPath,
      KEY_PATH: keyPath,
      HTML_DIR: htmlDirPath,
    };

    // 3. 启动 Node.js 后端
    let serverPath = path.join(__dirname, 'src', 'server.js');

    if (app.isPackaged) {
      serverPath = serverPath.replace('app.asar', 'app.asar.unpacked');
    }

    logToFile('MAIN', `serverPath=${serverPath}, exists=${fs.existsSync(serverPath)}`);

    if (!fs.existsSync(serverPath)) {
      throw new Error(`后端入口不存在: ${serverPath}`);
    }

    if (app.isPackaged) {
      nodeProcess = trackChild(fork(serverPath, [], {
        cwd: path.dirname(serverPath),
        silent: true,
        env,
      }));
    } else {
      nodeProcess = trackChild(fork(serverPath, [], {
        cwd: __dirname,
        silent: true,
        env,
        execPath: 'node',
      }));
    }

    nodeProcess.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) logToFile('NODE', text);
    });

    nodeProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) logToFile('NODE-ERR', text);
    });

    nodeProcess.on('error', (err) => {
      console.error('[Node.js] 进程错误:', err.message);
      logToFile('MAIN', `Node.js fork error: ${err.message}`);
    });

    nodeProcess.on('exit', (code, signal) => {
      console.log(`[Node.js] 进程退出，code=${code}, signal=${signal || ''}`);
      logToFile('MAIN', `Node.js exited with code=${code}, signal=${signal || ''}`);

      nodeProcess = null;

      if (isServicesRunning && servicesManagedByThisProcess && !stoppingServices) {
        isServicesRunning = false;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('service-status', { running: false });
        }
      }
    });

    nodeProcess.on('message', (msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'rtsp-status' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rtsp-status', msg.data);
      }

      if (msg.type === 'skill-loaded' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skill-loaded', msg.data);
      }

      if (msg.type === 'skill-error' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skill-error', msg.error);
      }

      if (msg.type === 'skill-list' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skill-list', msg.data);
      }
    });

    // 4. 启动 nginx
    const nginxBin = path.join(nginxDir, 'bin', getNginxPlatformBinary());
    const nginxConf = path.join(nginxDir, 'conf', 'nginx.conf');

    if (!fs.existsSync(nginxBin)) {
      throw new Error(`nginx 可执行文件不存在: ${nginxBin}`);
    }

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(nginxBin, 0o755);
      } catch (_) {}
    }

    nginxProcess = trackChild(spawn(nginxBin, [
      '-p', nginxDir,
      '-c', nginxConf,
    ], {
      stdio: 'ignore',
      windowsHide: true,
    }));

    nginxProcess.on('error', (err) => {
      console.error('[nginx] 进程错误:', err.message);
      logToFile('MAIN', `nginx error: ${err.message}`);
    });

    nginxProcess.on('exit', (code, signal) => {
      console.log(`[nginx] 进程退出，code=${code}, signal=${signal || ''}`);
      logToFile('MAIN', `nginx exited with code=${code}, signal=${signal || ''}`);

      nginxProcess = null;

      if (isServicesRunning && servicesManagedByThisProcess && !stoppingServices) {
        isServicesRunning = false;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('service-status', { running: false });
        }
      }
    });

    // 5. 添加 Windows 防火墙规则
    if (process.platform === 'win32') {
      const addRule = (name, port) => {
        trackChild(spawn('netsh', [
          'advfirewall',
          'firewall',
          'add',
          'rule',
          `name=${name}`,
          'dir=in',
          'action=allow',
          'protocol=TCP',
          `localport=${port}`
        ], {
          stdio: 'ignore',
          windowsHide: true
        }));
      };

      addRule('真視眼 CYPHER (nginx HTTPS)', String(actualNginxPort));
      addRule('真視眼 CYPHER (Node.js 后端)', String(actualNodePort));
    }

    // 6. 等待后端启动
    const lanIp = getLanIp();

    const backendStarted = await waitForBackend(actualNodePort, 15000);

    if (!backendStarted) {
      logToFile('MAIN', 'Backend failed to start within 15s');
      throw new Error('后端服务启动失败，请检查日志: ' + SERVER_LOG);
    }

    // 7. 等待 nginx 前端启动
    const nginxStarted = await waitForUrl(
      `https://127.0.0.1:${actualNginxPort}/dashboard`,
      15000
    );

    if (!nginxStarted) {
      logToFile('MAIN', 'nginx failed to start within 15s');
      throw new Error('nginx 前端启动失败，请检查日志: ' + SERVER_LOG);
    }

    isServicesRunning = true;
    servicesManagedByThisProcess = true;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', {
        running: true,
        lanIp,
        nodePort: actualNodePort,
        nginxPort: actualNginxPort
      });
    }

    return {
      success: true,
      lanIp,
      nodePort: actualNodePort,
      nginxPort: actualNginxPort
    };
  } catch (err) {
    logToFile('MAIN', `startServices failed: ${err.stack || err.message}`);

    await cleanupStartedServices().catch((cleanupErr) => {
      logToFile('MAIN', `cleanup after start failure failed: ${cleanupErr.stack || cleanupErr.message}`);
    });

    throw err;
  }
}

async function stopServices() {
  if (stoppingServices) {
    return {
      success: true,
      alreadyStopping: true
    };
  }

  stoppingServices = true;

  try {
    isServicesRunning = false;

    // 如果服务不是当前 Electron 启动的，例如 node dev.js --electron 场景，不主动杀外部服务
    if (!servicesManagedByThisProcess) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('service-status', { running: false });
      }

      return {
        success: true,
        skipped: true
      };
    }

    if (nodeProcess) {
      const np = nodeProcess;
      nodeProcess = null;
      await killProcess(np, 'Node.js');
    }

    // 无论 nginxProcess 是否存在，都尝试用 nginx 自己停
    stopNginxGracefully();

    if (nginxProcess) {
      const np = nginxProcess;
      nginxProcess = null;
      await killProcess(np, 'nginx');
    }

    await cleanupManagedChildren();

    servicesManagedByThisProcess = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', { running: false });
    }

    return {
      success: true
    };
  } finally {
    stoppingServices = false;
  }
}

function waitForProcessExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}

      resolve();
    }, timeoutMs);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanupManagedChildren() {
  for (const child of Array.from(managedChildren)) {
    try {
      if (!child || child.killed || !child.pid || child.exitCode !== null) {
        managedChildren.delete(child);
        continue;
      }

      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
          windowsHide: true,
          timeout: 3000
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      console.warn('[清理] 子进程清理失败:', err.message);
    }
  }
}

async function loadDashboardWithServices() {
  const dashboardUrl = () => `https://127.0.0.1:${actualNginxPort}/dashboard`;

  // 兼容 dev.js --electron：
  // 如果外部已经把 nginx 启起来了，Electron 直接打开，不再重复启动服务。
  const existingNginxReady = await waitForUrl(dashboardUrl(), 2500);

  if (existingNginxReady) {
    isServicesRunning = true;
    servicesManagedByThisProcess = false;

    const lanIp = getLanIp();

    logToFile('MAIN', `Using existing nginx dashboard: ${dashboardUrl()}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', {
        running: true,
        lanIp,
        nodePort: actualNodePort,
        nginxPort: actualNginxPort
      });
    }

    await mainWindow.loadURL(dashboardUrl());
    return;
  }

  // 直接运行 Electron 的场景：由 Electron 自己启动服务。
  await startServices(process.env.NODE_PORT || process.env.PORT, process.env.NGINX_PORT);
  await mainWindow.loadURL(dashboardUrl());
}

// ==========================================
// 窗口管理
// ==========================================
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: '真視眼 CYPHER',
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logToFile('WINDOW', `did-fail-load code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logToFile('WINDOW', `render-process-gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logToFile('RENDER', `[level=${level}] ${message} (${sourceId}:${line})`);
  });

  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '连接 RTSP 流...',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('open-rtsp-dialog');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  try {
    await loadDashboardWithServices();
  } catch (err) {
    logToFile('MAIN', `loadDashboardWithServices failed: ${err.stack || err.message}`);

    const controlPath = path.join(__dirname, 'html', 'control.html');

    if (fs.existsSync(controlPath)) {
      await mainWindow.loadFile(controlPath);
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '启动失败',
        message: '服务启动失败，且 control.html 不存在。',
        detail: `${err.message}\n\n日志路径：${SERVER_LOG || '未知'}`,
        buttons: ['确定']
      });
    }
  }
}

// ==========================================
// IPC 通信
// ==========================================
ipcMain.handle('start-services', async (_event, customNodePort, customNginxPort) => {
  try {
    const result = await startServices(customNodePort, customNginxPort);

    return {
      ...result,
      nodePort: actualNodePort,
      nginxPort: actualNginxPort
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('get-ports', () => {
  return {
    nodePort: actualNodePort,
    nginxPort: actualNginxPort
  };
});

ipcMain.handle('stop-services', async () => {
  return stopServices();
});

ipcMain.handle('get-service-status', () => {
  return {
    running: isServicesRunning,
    managed: servicesManagedByThisProcess,
    nodePort: actualNodePort,
    nginxPort: actualNginxPort
  };
});

ipcMain.handle('get-lan-ip', () => {
  return getLanIp();
});

// RTSP 相关 IPC
ipcMain.handle('connect-rtsp', async (_event, url) => {
  if (!nodeProcess) {
    return {
      success: false,
      error: '后端服务未运行，请先启动服务'
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({ type: 'start-rtsp', url });

    const onMessage = (msg) => {
      if (msg && msg.type === 'rtsp-status') {
        nodeProcess.removeListener('message', onMessage);
        clearTimeout(timer);

        resolve({
          success: true,
          ...msg.data
        });
      }
    };

    nodeProcess.on('message', onMessage);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', onMessage);

      resolve({
        success: true,
        status: 'connecting'
      });
    }, 3000);
  });
});

ipcMain.handle('disconnect-rtsp', async () => {
  if (!nodeProcess) {
    return {
      success: false,
      error: '后端服务未运行'
    };
  }

  nodeProcess.send({ type: 'stop-rtsp' });

  return {
    success: true
  };
});

ipcMain.handle('get-rtsp-status', async () => {
  if (!nodeProcess) {
    return {
      status: 'disconnected',
      url: '',
      error: '',
      frameCount: 0
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({ type: 'get-rtsp-status' });

    const onMessage = (msg) => {
      if (msg && msg.type === 'rtsp-status') {
        nodeProcess.removeListener('message', onMessage);
        clearTimeout(timer);
        resolve(msg.data);
      }
    };

    nodeProcess.on('message', onMessage);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', onMessage);

      resolve({
        status: 'disconnected',
        url: '',
        error: '',
        frameCount: 0
      });
    }, 2000);
  });
});

// 技能管理 IPC
ipcMain.handle('list-skills', async () => {
  if (!nodeProcess) {
    return {
      skills: [],
      active: null
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({ type: 'list-skills' });

    const onMessage = (msg) => {
      if (msg && msg.type === 'skill-list') {
        nodeProcess.removeListener('message', onMessage);
        clearTimeout(timer);
        resolve(msg.data);
      }
    };

    nodeProcess.on('message', onMessage);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', onMessage);

      resolve({
        skills: [],
        active: null
      });
    }, 3000);
  });
});

ipcMain.handle('load-skill', async (_event, skillName) => {
  if (!nodeProcess) {
    return {
      success: false,
      error: '后端服务未运行'
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({
      type: 'load-skill',
      skill: skillName
    });

    const handler = (msg) => {
      if (msg && msg.type === 'skill-loaded') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: true,
          active: msg.data
        });
      }
    };

    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: false,
          error: msg.error
        });
      }
    };

    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);

      resolve({
        success: false,
        error: '技能操作超时'
      });
    }, 5000);
  });
});

ipcMain.handle('toggle-skill', async (_event, skillId, enabled) => {
  if (!nodeProcess) {
    return {
      success: false,
      error: '后端服务未运行'
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({
      type: 'toggle-skill',
      skill: skillId,
      enabled
    });

    const handler = (msg) => {
      if (msg && msg.type === 'skill-toggled') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: true,
          data: msg.data
        });
      }
    };

    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: false,
          error: msg.error
        });
      }
    };

    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);

      resolve({
        success: false,
        error: '操作超时'
      });
    }, 5000);
  });
});

ipcMain.handle('install-skill', async (_event, fileName, content) => {
  if (!nodeProcess) {
    return {
      success: false,
      error: '后端服务未运行'
    };
  }

  return new Promise((resolve) => {
    nodeProcess.send({
      type: 'install-skill',
      fileName,
      content
    });

    const handler = (msg) => {
      if (msg && msg.type === 'skill-installed') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: true,
          data: msg.data
        });
      }
    };

    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);

        resolve({
          success: false,
          error: msg.error
        });
      }
    };

    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);

    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);

      resolve({
        success: false,
        error: '操作超时'
      });
    }, 5000);
  });
});

ipcMain.handle('open-skill-file', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择技能文件',
    filters: [
      {
        name: '技能文件',
        extensions: ['js', 'py']
      },
      {
        name: '所有文件',
        extensions: ['*']
      }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    fileName,
    content,
    filePath
  };
});

// 打开文件夹（用于录制文件）
ipcMain.handle('open-folder', async (_event, folderPath) => {
  try {
    // 使用 shell.openPath 打开文件夹
    await shell.openPath(folderPath);
    return { success: true };
  } catch (err) {
    console.error('[open-folder] 失败:', err.message);
    return { success: false, error: err.message };
  }
});

// ==========================================
// 用户配置读写
// ==========================================
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch (_) {}

  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (_) {}
}

// ==========================================
// Python 环境依赖检测与自动安装
// ==========================================
function scanPythons() {
  const candidates = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];

  const found = [];

  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 3000
      });

      if (result.status === 0 || result.status === null) {
        const version = (result.stdout || result.stderr || '').trim().replace('Python ', '');

        found.push({
          cmd,
          version
        });
      }
    } catch (_) {}
  }

  return found;
}

function checkPythonPackage(pythonCmd, importName) {
  try {
    const result = spawnSync(pythonCmd, ['-c', `import ${importName}`], {
      encoding: 'utf-8',
      timeout: 5000
    });

    return result.status === 0;
  } catch (_) {
    return false;
  }
}

function getPythonPackagesStatus(pythonCmd) {
  const packages = [
    {
      name: 'ultralytics',
      import: 'ultralytics'
    },
    {
      name: 'Pillow',
      import: 'PIL'
    },
    {
      name: 'requests',
      import: 'requests'
    },
  ];

  return packages.map(p => ({
    ...p,
    installed: checkPythonPackage(pythonCmd, p.import),
  }));
}

async function checkPythonDependencies() {
  const missing = [];

  const modelCandidates = [
    process.env.CYPHER_YOLO_MODEL,
    process.env.CYPHER_YOLO_PPE_MODEL,
    process.env.CYPHER_YOLO_FIRE_MODEL,
    path.join(__dirname, 'models', 'yolo-safety.pt'),
    path.join(__dirname, 'skills', 'best.pt')
  ].filter(Boolean);

  const hasModel = modelCandidates.some((candidate) => {
    const modelPath = path.isAbsolute(candidate)
      ? candidate
      : path.join(__dirname, candidate);

    return fs.existsSync(modelPath);
  });

  if (!hasModel) {
    missing.push('YOLO 模型文件缺失: 设置 CYPHER_YOLO_MODEL 或提供 models/yolo-safety.pt / skills/best.pt');
  }

  const allPythons = scanPythons();

  if (allPythons.length === 0) {
    missing.push('Python 未安装（需要 Python 3.10+）');

    return {
      missing,
      pythonCmd: null,
      allPythons: []
    };
  }

  const settings = loadSettings();
  let pythonCmd = null;
  let usedPreferred = false;
  let depReadyCmd = null;

  for (const p of allPythons) {
    const pkgs = getPythonPackagesStatus(p.cmd);

    if (pkgs.every(pkg => pkg.installed)) {
      depReadyCmd = p.cmd;
      break;
    }
  }

  if (settings.preferredPython) {
    const pref = settings.preferredPython;
    const found = allPythons.find(p => p.cmd === pref);

    if (found) {
      const prefPkgs = getPythonPackagesStatus(found.cmd);

      if (prefPkgs.every(pkg => pkg.installed) || !depReadyCmd) {
        pythonCmd = found.cmd;
        usedPreferred = true;
      }
    } else if (fs.existsSync(pref)) {
      try {
        const result = spawnSync(pref, ['--version'], {
          encoding: 'utf-8',
          timeout: 3000
        });

        if (result.status === 0 || result.status === null) {
          const version = (result.stdout || result.stderr || '').trim().replace('Python ', '');

          allPythons.push({
            cmd: pref,
            version
          });

          const newPkgs = getPythonPackagesStatus(pref);

          if (newPkgs.every(pkg => pkg.installed) || !depReadyCmd) {
            pythonCmd = pref;
            usedPreferred = true;

            if (!depReadyCmd && newPkgs.every(pkg => pkg.installed)) {
              depReadyCmd = pref;
            }
          }
        }
      } catch (_) {}
    }
  }

  if (!pythonCmd) {
    pythonCmd = depReadyCmd || allPythons[0].cmd;
  }

  const packages = getPythonPackagesStatus(pythonCmd);

  for (const pkg of packages) {
    if (!pkg.installed) {
      missing.push(`Python 包未安装: ${pkg.name}`);
    }
  }

  return {
    missing,
    pythonCmd,
    allPythons,
    packages,
    usedPreferred
  };
}

async function autoInstallDeps(pythonCmd) {
  return new Promise((resolve) => {
    const pipArgs = [
      '-m',
      'pip',
      'install',
      'ultralytics',
      'Pillow',
      'requests',
      '--no-warn-script-location'
    ];

    const pipProc = trackChild(spawn(pythonCmd, pipArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }));

    let stdout = '';
    let stderr = '';

    pipProc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    pipProc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    pipProc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr
      });
    });

    pipProc.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message
      });
    });
  });
}

// ==========================================
// 应用生命周期
// ==========================================
app.whenReady().then(async () => {
  let checkResult = await checkPythonDependencies();
  let missing = checkResult.missing;

  if (process.env.AUTO_START === '1') {
    missing = [];
  }

  while (missing.length > 0) {
    const allPythons = checkResult.allPythons || [];
    const currentCmd = checkResult.pythonCmd || '无';

    let detail = '';

    if (allPythons.length > 0) {
      detail += '检测到的 Python 环境：\n';

      for (const p of allPythons) {
        const pkgs = getPythonPackagesStatus(p.cmd);
        const marks = pkgs.map(pkg => (pkg.installed ? '✓' : '✗') + ' ' + pkg.name).join('  ');
        const marker = p.cmd === currentCmd ? ' → 当前使用' : '';

        detail += `[${p.cmd}] ${p.version}  ${marks}${marker}\n`;
      }

      detail += '\n';
    }

    detail += '缺失项：\n' + missing.join('\n');

    const buttons = [];
    const buttonActions = [];

    for (const p of allPythons) {
      if (p.cmd === currentCmd) continue;

      const pkgs = getPythonPackagesStatus(p.cmd);
      const allInstalled = pkgs.every(pkg => pkg.installed);

      if (allInstalled) {
        buttons.push(`切换到 ${p.cmd} (${p.version})`);
        buttonActions.push({
          type: 'switch',
          cmd: p.cmd
        });
      }
    }

    if (checkResult.pythonCmd) {
      buttons.push(`在 ${currentCmd} 安装依赖`);
      buttonActions.push({
        type: 'install'
      });
    }

    buttons.push('手动指定 Python 路径');
    buttonActions.push({
      type: 'browse'
    });

    buttons.push('仍要启动');
    buttonActions.push({
      type: 'skip'
    });

    buttons.push('退出');
    buttonActions.push({
      type: 'quit'
    });

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '依赖检测',
      message: '检测到以下依赖缺失，部分 AI 技能（YOLO 安全检测）将无法启动：',
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    });

    const action = buttonActions[response];

    if (!action || action.type === 'quit') {
      app.quit();
      return;
    }

    if (action.type === 'skip') {
      break;
    }

    if (action.type === 'switch') {
      saveSettings({
        ...loadSettings(),
        preferredPython: action.cmd
      });

      checkResult = await checkPythonDependencies();
      missing = checkResult.missing;

      if (missing.length === 0) {
        await dialog.showMessageBox({
          type: 'info',
          title: '切换成功',
          message: `已切换到 ${action.cmd}，所有依赖已就绪。`,
          buttons: ['确定'],
        });

        break;
      }

      continue;
    }

    if (action.type === 'browse') {
      const { filePaths } = await dialog.showOpenDialog({
        title: '选择 Python 可执行文件',
        properties: ['openFile'],
        filters: [
          {
            name: 'Python 可执行文件',
            extensions: ['exe']
          },
          {
            name: '所有文件',
            extensions: ['*']
          },
        ],
      });

      if (!filePaths || filePaths.length === 0) {
        continue;
      }

      const customPath = filePaths[0];

      try {
        const result = spawnSync(customPath, ['--version'], {
          encoding: 'utf-8',
          timeout: 3000
        });

        if (result.status !== 0 && result.status !== null) {
          await dialog.showMessageBox({
            type: 'error',
            title: '无效路径',
            message: '选择的文件不是有效的 Python 可执行文件。',
            buttons: ['确定'],
          });

          continue;
        }
      } catch (_) {
        await dialog.showMessageBox({
          type: 'error',
          title: '无效路径',
          message: '无法执行选择的文件。',
          buttons: ['确定'],
        });

        continue;
      }

      saveSettings({
        ...loadSettings(),
        preferredPython: customPath
      });

      checkResult = await checkPythonDependencies();
      missing = checkResult.missing;

      if (missing.length === 0) {
        await dialog.showMessageBox({
          type: 'info',
          title: '设置成功',
          message: '自定义 Python 路径已保存，所有依赖已就绪。',
          buttons: ['确定'],
        });

        break;
      }

      continue;
    }

    if (action.type === 'install') {
      dialog.showMessageBox({
        type: 'info',
        title: '正在安装',
        message: `正在通过 pip 安装依赖到 ${checkResult.pythonCmd}...`,
        detail: ' ultralytics\n Pillow\n requests\n\n请稍候，安装完成后将自动检测。',
        buttons: [],
      }).catch(() => {});

      const result = await autoInstallDeps(checkResult.pythonCmd);

      if (result.success) {
        checkResult = await checkPythonDependencies();
        missing = checkResult.missing;

        if (missing.length === 0) {
          await dialog.showMessageBox({
            type: 'info',
            title: '安装完成',
            message: '依赖安装成功！',
            detail: '所有 Python 依赖已就绪，点击确定启动应用。',
            buttons: ['确定'],
          });

          break;
        }

        await dialog.showMessageBox({
          type: 'warning',
          title: '安装完成',
          message: '依赖安装结束，但仍有缺失项：',
          detail: missing.join('\n') + '\n\n请手动执行安装命令排查。',
          buttons: ['确定'],
        });

        continue;
      }

      await dialog.showMessageBox({
        type: 'error',
        title: '安装失败',
        message: 'pip 安装失败，请手动安装。',
        detail: '请打开命令行执行以下命令：\n' +
          `${checkResult.pythonCmd} -m pip install ultralytics Pillow requests\n\n错误信息：\n${result.stderr.slice(-500)}`,
        buttons: ['确定'],
      });
    }
  }

  await createWindow();
});

app.on('window-all-closed', () => {
  stopServices().then(() => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }).catch(() => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

app.on('before-quit', () => {
  stopServices().catch(() => {});
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

process.on('uncaughtException', (err) => {
  logToFile('MAIN', `uncaughtException: ${err.stack || err.message}`);
  stopServices().finally(() => {
    app.quit();
  });
});

process.on('unhandledRejection', (err) => {
  logToFile('MAIN', `unhandledRejection: ${err && err.stack ? err.stack : String(err)}`);
});
