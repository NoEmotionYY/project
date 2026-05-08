require('dotenv').config();
const { app, BrowserWindow, ipcMain, session, Menu, dialog } = require('electron');
const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ==========================================
// 全局状态
// ==========================================
let mainWindow;
let nodeProcess = null;
let nginxProcess = null;
let isServicesRunning = false;
let actualNodePort = Number(process.env.NODE_PORT || process.env.PORT || 8082);
let actualNginxPort = Number(process.env.NGINX_PORT || 8443);
const managedChildren = new Set();

const { findAvailablePort } = require('./src/port-utils');

// 日志工具：打包后存到 exe 同级目录，开发模式存到 userData
let LOG_DIR;
let SERVER_LOG;

function initLogDir() {
  if (LOG_DIR) return;
  const isPackaged = app.isPackaged;
  LOG_DIR = isPackaged
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
  } catch (e) { console.error('logToFile error:', e.message); }
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

// 忽略自签名证书错误
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('ignore-connections-limit', '127.0.0.1');

// ==========================================
// 工具函数
// ==========================================
function getLanIp() {
  const ips = [];
  const virtualKeywords = ['vmware', 'virtualbox', 'docker', 'vpn', 'tun', 'tap', 'ppp', 'mihomo', 'veth', 'hyper-v'];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = virtualKeywords.some(v => lowerName.includes(v));
    for (const iface of interfaces[name]) {
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
  const map = { win32: 'nginx-win.exe', darwin: 'nginx-mac', linux: 'nginx-linux' };
  return map[process.platform] || 'nginx-linux';
}

function getNginxSourceDir() {
  const isDev = !app.isPackaged;
  return isDev
    ? path.join(__dirname, 'nginx')
    : path.join(process.resourcesPath, 'nginx-runtime');
}

function getNginxRuntimeDir() {
  return path.join(app.getPath('userData'), 'nginx-runtime');
}

function ensureNginxRuntime() {
  const source = getNginxSourceDir();
  const runtime = getNginxRuntimeDir();

  const nginxBin = path.join(runtime, 'bin', getNginxPlatformBinary());
  if (!fs.existsSync(runtime) || !fs.existsSync(nginxBin)) {
    copyDir(source, runtime);
  }

  // 复制 UI 文件到 nginx 的 html 目录（用于 nginx 独立部署的前端）
  const uiSource = path.join(__dirname, 'html');
  const uiDest = path.join(runtime, 'html');
  if (fs.existsSync(uiSource)) {
    const uiFiles = fs.readdirSync(uiSource);
    for (const file of uiFiles) {
      fs.copyFileSync(path.join(uiSource, file), path.join(uiDest, file));
    }
  }

  // 确保证书文件始终最新（即使运行时目录已存在）
  const certSource = path.join(source, 'cert.pem');
  const keySource = path.join(source, 'key.pem');
  const certDest = path.join(runtime, 'cert.pem');
  const keyDest = path.join(runtime, 'key.pem');
  if (fs.existsSync(certSource)) fs.copyFileSync(certSource, certDest);
  if (fs.existsSync(keySource)) fs.copyFileSync(keySource, keyDest);

  // 确保临时目录存在
  const temps = ['logs', 'temp', 'temp/client_body_temp', 'temp/proxy_temp', 'temp/fastcgi_temp', 'temp/uwsgi_temp', 'temp/scgi_temp'];
  for (const t of temps) {
    fs.mkdirSync(path.join(runtime, t), { recursive: true });
  }

  return runtime;
}

function writeNginxConf(nginxDir, nodePort = 8082, nginxPort = 8443) {
  const confPath = path.join(nginxDir, 'conf', 'nginx.conf');
  const certPath = path.join(nginxDir, 'cert.pem').replace(/\\/g, '/');
  const keyPath = path.join(nginxDir, 'key.pem').replace(/\\/g, '/');
  const htmlPath = path.join(nginxDir, 'html').replace(/\\/g, '/');
  const tempPath = path.join(nginxDir, 'temp').replace(/\\/g, '/');
  const logsPath = path.join(nginxDir, 'logs').replace(/\\/g, '/');

  const conf = `worker_processes  1;
error_log ${logsPath}/error.log;
pid ${logsPath}/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;

    client_body_temp_path ${tempPath}/client_body_temp;
    proxy_temp_path ${tempPath}/proxy_temp;
    fastcgi_temp_path ${tempPath}/fastcgi_temp;
    uwsgi_temp_path ${tempPath}/uwsgi_temp;
    scgi_temp_path ${tempPath}/scgi_temp;

    server {
        listen       ${nginxPort} ssl;
        server_name  localhost;

        ssl_certificate      ${certPath};
        ssl_certificate_key  ${keyPath};
        ssl_session_cache    shared:SSL:1m;
        ssl_session_timeout  5m;
        ssl_ciphers  HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers  on;

        location / {
            root   ${htmlPath};
            index  webrtc-client.html;
            try_files $uri $uri/ =404;
        }

        location /monitor {
            alias  ${htmlPath}/dashboard.html;
            default_type text/html;
        }

        location /test {
            alias  ${htmlPath}/test-capture.html;
            default_type text/html;
        }

        location /desktop {
            alias  ${htmlPath}/desktop-capture.html;
            default_type text/html;
        }

        location /recordings {
            alias  ${htmlPath}/recordings.html;
            default_type text/html;
        }

        # 反向代理：前端同域请求自动转发到 Node.js 后端
        location /events {
            alias  ${htmlPath}/events.html;
            default_type text/html;
        }

        location /settings {
            alias  ${htmlPath}/settings.html;
            default_type text/html;
        }

        location /dashboard {
            alias  ${htmlPath}/dashboard.html;
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
        }

        location /offer {
            proxy_pass https://127.0.0.1:${nodePort}/offer;
            proxy_http_version 1.1;
        }
    }
}
`;
  fs.writeFileSync(confPath, conf, 'utf-8');
}

// ==========================================
// 服务管理
// ==========================================
async function waitForBackend(port, timeoutMs) {
  const https = require('https');
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const req = https.get(`https://127.0.0.1:${port}/api/info`, {
        rejectUnauthorized: false,
        timeout: 2000,
      }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          setTimeout(check, 500);
        }
      });
      req.on('error', () => {
        setTimeout(check, 500);
      });
      req.on('timeout', () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };
    // 先等 1 秒让进程启动
    setTimeout(check, 1000);
  });
}

async function startServices(customNodePort, customNginxPort) {
  if (isServicesRunning) {
    return { success: true, lanIp: getLanIp(), nodePort: actualNodePort, nginxPort: actualNginxPort };
  }

  // 0. 检测端口
  console.log('[端口] 检测可用端口...');
  try {
    // 如果传入了自定义端口，从自定义端口开始检测；否则使用默认端口
    const nodeStartPort = customNodePort ? parseInt(customNodePort, 10) : 8082;
    const nginxStartPort = customNginxPort ? parseInt(customNginxPort, 10) : 8443;
    actualNodePort = await findAvailablePort(nodeStartPort);
    actualNginxPort = await findAvailablePort(nginxStartPort);
    console.log(`[端口] Node.js: ${actualNodePort}, nginx: ${actualNginxPort}`);
  } catch (e) {
    console.error('[端口]', e.message);
    throw e;
  }

  try {
    // 1. 准备 nginx 运行时目录
    const nginxDir = ensureNginxRuntime();
    writeNginxConf(nginxDir, actualNodePort, actualNginxPort);

    // 2. 设置环境变量
    const settings = loadSettings();
    const isPackaged = app.isPackaged;
    // 打包后 node_modules 在 app.asar 内，asarUnpack 的模块在 app.asar.unpacked，都要加入 NODE_PATH
    const asarNodeModules = isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'node_modules')
      : null;
    const asarUnpackedNodeModules = isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
      : null;
    const nodePaths = [asarNodeModules, process.env.NODE_PATH, asarUnpackedNodeModules].filter(Boolean).join(path.delimiter);

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
      LOG_DIR: LOG_DIR,
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
    // 打包后 src 被解压到 app.asar.unpacked，需要替换路径
    if (app.isPackaged) {
      serverPath = serverPath.replace('app.asar', 'app.asar.unpacked');
    }
    logToFile('MAIN', `serverPath=${serverPath}, exists=${fs.existsSync(serverPath)}`);

    if (app.isPackaged) {
      // 打包后：直接用 fork（electron-rebuild 已确保 native 模块兼容）
      nodeProcess = trackChild(fork(serverPath, [], {
        cwd: path.dirname(serverPath),
        silent: true,
        env,
      }));
    } else {
      // 开发模式：用系统 Node.js 避免 ABI 不兼容
      nodeProcess = trackChild(fork(serverPath, [], {
        cwd: __dirname,
        silent: true,
        env,
        execPath: 'node',
      }));
    }

    // 捕获子进程日志到文件
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

    nodeProcess.on('exit', (code) => {
      console.log(`[Node.js] 进程退出，code=${code}`);
      logToFile('MAIN', `Node.js exited with code ${code}`);
      nodeProcess = null;
      if (isServicesRunning) {
        isServicesRunning = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('service-status', { running: false });
        }
      }
    });

    // 监听 Node.js 子进程的 IPC 消息（RTSP 状态、技能状态等）
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
    // macOS/Linux: 修复从 asar 解压后丢失的可执行权限
    if (process.platform !== 'win32') {
      try { fs.chmodSync(nginxBin, 0o755); } catch (_) {}
    }
    nginxProcess = trackChild(spawn(nginxBin, [
      '-p', nginxDir,
      '-c', path.join(nginxDir, 'conf', 'nginx.conf'),
    ], {
      stdio: 'ignore',
      windowsHide: true,
    }));

    nginxProcess.on('error', (err) => {
      console.error('[nginx] 进程错误:', err.message);
      logToFile('MAIN', `nginx error: ${err.message}`);
    });

    nginxProcess.on('exit', (code) => {
      console.log(`[nginx] 进程退出，code=${code}`);
      logToFile('MAIN', `nginx exited with code ${code}`);
      nginxProcess = null;
    });

    // 5. 添加 Windows 防火墙规则（允许局域网访问）
    if (process.platform === 'win32') {
      const addRule = (name, port) => {
        trackChild(spawn('netsh', ['advfirewall', 'firewall', 'add', 'rule',
          `name=${name}`, 'dir=in', 'action=allow',
          'protocol=TCP', `localport=${port}`
        ], { stdio: 'ignore', windowsHide: true }));
      };
      addRule('真視眼 CYPHER (nginx HTTPS)', String(actualNginxPort));
      addRule('真視眼 CYPHER (Node.js 后端)', String(actualNodePort));
    }

    // 6. 等待后端实际启动成功（轮询 /api/info，最多 10 秒）
    const lanIp = getLanIp();
    const started = await waitForBackend(actualNodePort, 10000);
    if (!started) {
      logToFile('MAIN', 'Backend failed to start within 10s');
      throw new Error('后端服务启动失败，请检查日志: ' + SERVER_LOG);
    }

    isServicesRunning = true;

    // 通知 renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', { running: true, lanIp });
    }

    return { success: true, lanIp, nodePort: actualNodePort, nginxPort: actualNginxPort };
  } catch (err) {
    throw err;
  }
}

async function stopServices() {
  isServicesRunning = false;

  // 1. 优雅停止 Node.js 后端
  if (nodeProcess) {
    const np = nodeProcess;
    const pid = np.pid;
    nodeProcess = null;
    np.kill();
    // 等待进程退出，最多 3 秒
    await waitForProcessExit(np, 3000);
    // 兜底：如果进程还在，用 taskkill 强制终止（/T 同时终止子进程）
    if (pid && process.platform === 'win32') {
      try {
        require('child_process').spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 3000 });
        console.log(`[清理] 已强制终止 Node.js PID ${pid}`);
      } catch (_) {}
    }
  }

  // 2. 优雅停止 nginx（使用 nginx -s stop）
  if (nginxProcess) {
    const np = nginxProcess;
    const pid = np.pid;
    const nginxDir = getNginxRuntimeDir();
    const nginxBin = path.join(nginxDir, 'bin', getNginxPlatformBinary());

    // 先尝试用 nginx 自身的 stop 命令
    try {
      const stopResult = require('child_process').spawnSync(nginxBin, ['-s', 'stop', '-p', nginxDir], { timeout: 5000, windowsHide: true });
      console.log('[nginx] 发送 stop 命令, 状态:', stopResult.status);
    } catch (e) {
      console.warn('[nginx] stop 命令失败:', e.message);
    }

    // 等待进程退出，最多 3 秒
    await waitForProcessExit(np, 3000);
    nginxProcess = null;
    // 兜底：如果进程还在，用 taskkill 强制终止（/T 同时终止子进程）
    if (pid && process.platform === 'win32') {
      try {
        require('child_process').spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 3000 });
        console.log(`[清理] 已强制终止 nginx PID ${pid}`);
      } catch (_) {}
    }
  }

  // 3. 兜底：只清理当前应用记录过的子进程
  await cleanupManagedChildren();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('service-status', { running: false });
  }

  return { success: true };
}

function waitForProcessExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, timeoutMs);
    proc.on('exit', () => {
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
        require('child_process').spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, timeout: 3000 });
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      console.warn('[清理] 子进程清理失败:', err.message);
    }
  }
}

// ==========================================
// 窗口管理
// ==========================================
function createWindow() {
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

  // 加载新版 dashboard 主界面；/monitor 仅保留兼容入口。
  mainWindow.loadFile(path.join(__dirname, 'html', 'dashboard.html'));

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

  // 信任自签名证书
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
  });

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(0);
  });
}

// ==========================================
// IPC 通信
// ==========================================
ipcMain.handle('start-services', async (_event, customNodePort, customNginxPort) => {
  try {
    const result = await startServices(customNodePort, customNginxPort);
    return { ...result, nodePort: actualNodePort, nginxPort: actualNginxPort };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-ports', () => {
  return { nodePort: actualNodePort, nginxPort: actualNginxPort };
});

ipcMain.handle('stop-services', async () => {
  const result = await stopServices();
  return result;
});

ipcMain.handle('get-service-status', () => {
  return { running: isServicesRunning };
});

ipcMain.handle('get-lan-ip', () => {
  return getLanIp();
});

// RTSP 相关 IPC
ipcMain.handle('connect-rtsp', async (_event, url) => {
  if (!nodeProcess) {
    return { success: false, error: '后端服务未运行，请先启动服务' };
  }
  return new Promise((resolve) => {
    nodeProcess.send({ type: 'start-rtsp', url });
    const onMessage = (msg) => {
      if (msg && msg.type === 'rtsp-status') {
        nodeProcess.removeListener('message', onMessage);
        clearTimeout(timer);
        resolve({ success: true, ...msg.data });
      }
    };
    nodeProcess.on('message', onMessage);
    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', onMessage);
      resolve({ success: true, status: 'connecting' });
    }, 3000);
  });
});

ipcMain.handle('disconnect-rtsp', async () => {
  if (!nodeProcess) {
    return { success: false, error: '后端服务未运行' };
  }
  nodeProcess.send({ type: 'stop-rtsp' });
  return { success: true };
});

ipcMain.handle('get-rtsp-status', async () => {
  if (!nodeProcess) {
    return { status: 'disconnected', url: '', error: '', frameCount: 0 };
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
      resolve({ status: 'disconnected', url: '', error: '', frameCount: 0 });
    }, 2000);
  });
});

// 技能管理 IPC
ipcMain.handle('list-skills', async () => {
  if (!nodeProcess) {
    return { skills: [], active: null };
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
      resolve({ skills: [], active: null });
    }, 3000);
  });
});

ipcMain.handle('load-skill', async (_event, skillName) => {
  if (!nodeProcess) {
    return { success: false, error: '后端服务未运行' };
  }
  return new Promise((resolve) => {
    nodeProcess.send({ type: 'load-skill', skill: skillName });
    const handler = (msg) => {
      if (msg && msg.type === 'skill-loaded') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);
        resolve({ success: true, active: msg.data });
      }
    };
    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);
        resolve({ success: false, error: msg.error });
      }
    };
    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);
    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);
      resolve({ success: false, error: '技能操作超时' });
    }, 5000);
  });
});

ipcMain.handle('toggle-skill', async (_event, skillId, enabled) => {
  if (!nodeProcess) return { success: false, error: '后端服务未运行' };
  return new Promise((resolve) => {
    nodeProcess.send({ type: 'toggle-skill', skill: skillId, enabled });
    const handler = (msg) => {
      if (msg && msg.type === 'skill-toggled') {
        nodeProcess.removeListener('message', handler);
        clearTimeout(timer);
        resolve({ success: true, data: msg.data });
      }
    };
    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);
        resolve({ success: false, error: msg.error });
      }
    };
    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);
    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);
      resolve({ success: false, error: '操作超时' });
    }, 5000);
  });
});

ipcMain.handle('install-skill', async (_event, fileName, content) => {
  if (!nodeProcess) return { success: false, error: '后端服务未运行' };
  return new Promise((resolve) => {
    nodeProcess.send({ type: 'install-skill', fileName, content });
    const handler = (msg) => {
      if (msg && msg.type === 'skill-installed') {
        nodeProcess.removeListener('message', handler);
        clearTimeout(timer);
        resolve({ success: true, data: msg.data });
      }
    };
    const errorHandler = (msg) => {
      if (msg && msg.type === 'skill-error') {
        nodeProcess.removeListener('message', handler);
        nodeProcess.removeListener('message', errorHandler);
        clearTimeout(timer);
        resolve({ success: false, error: msg.error });
      }
    };
    nodeProcess.on('message', handler);
    nodeProcess.on('message', errorHandler);
    const timer = setTimeout(() => {
      nodeProcess.removeListener('message', handler);
      nodeProcess.removeListener('message', errorHandler);
      resolve({ success: false, error: '操作超时' });
    }, 5000);
  });
});

ipcMain.handle('open-skill-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择技能文件',
    filters: [
      { name: '技能文件', extensions: ['js', 'py'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  return { fileName, content, filePath };
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
      const result = require('child_process').spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 3000 });
      if (result.status === 0 || result.status === null) {
        const version = (result.stdout || result.stderr || '').trim().replace('Python ', '');
        found.push({ cmd, version });
      }
    } catch (_) {}
  }
  return found;
}

function checkPythonPackage(pythonCmd, importName) {
  try {
    const result = require('child_process').spawnSync(pythonCmd, ['-c', `import ${importName}`], { encoding: 'utf-8', timeout: 5000 });
    return result.status === 0;
  } catch (_) {
    return false;
  }
}

function getPythonPackagesStatus(pythonCmd) {
  const packages = [
    { name: 'ultralytics', import: 'ultralytics' },
    { name: 'Pillow', import: 'PIL' },
    { name: 'requests', import: 'requests' },
  ];
  return packages.map(p => ({
    ...p,
    installed: checkPythonPackage(pythonCmd, p.import),
  }));
}

async function checkPythonDependencies() {
  const missing = [];

  // 1. 检查模型文件
  const modelCandidates = [
    process.env.CYPHER_YOLO_MODEL,
    process.env.CYPHER_YOLO_PPE_MODEL,
    process.env.CYPHER_YOLO_FIRE_MODEL,
    path.join(__dirname, 'models', 'yolo-safety.pt'),
    path.join(__dirname, 'skills', 'best.pt')
  ].filter(Boolean);
  const hasModel = modelCandidates.some((candidate) => {
    const modelPath = path.isAbsolute(candidate) ? candidate : path.join(__dirname, candidate);
    return fs.existsSync(modelPath);
  });
  if (!hasModel) {
    missing.push('YOLO 模型文件缺失: 设置 CYPHER_YOLO_MODEL 或提供 models/yolo-safety.pt / skills/best.pt');
  }

  // 2. 扫描所有 Python
  const allPythons = scanPythons();
  if (allPythons.length === 0) {
    missing.push('Python 未安装（需要 Python 3.10+）');
    return { missing, pythonCmd: null, allPythons: [] };
  }

  // 3. 找出所有依赖齐全的 Python，优先作为默认
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
        const result = require('child_process').spawnSync(pref, ['--version'], { encoding: 'utf-8', timeout: 3000 });
        if (result.status === 0 || result.status === null) {
          const version = (result.stdout || result.stderr || '').trim().replace('Python ', '');
          allPythons.push({ cmd: pref, version });
          const newPkgs = getPythonPackagesStatus(pref);
          if (newPkgs.every(pkg => pkg.installed) || !depReadyCmd) {
            pythonCmd = pref;
            usedPreferred = true;
            if (!depReadyCmd && newPkgs.every(pkg => pkg.installed)) depReadyCmd = pref;
          }
        }
      } catch (_) {}
    }
  }

  // 4. 默认使用依赖齐全的 Python，否则回退到第一个
  if (!pythonCmd) {
    pythonCmd = depReadyCmd || allPythons[0].cmd;
  }

  // 5. 检查该 Python 的包
  const packages = getPythonPackagesStatus(pythonCmd);
  for (const pkg of packages) {
    if (!pkg.installed) {
      missing.push(`Python 包未安装: ${pkg.name}`);
    }
  }

  return { missing, pythonCmd, allPythons, packages, usedPreferred };
}

async function autoInstallDeps(pythonCmd) {
  return new Promise((resolve) => {
    const pipArgs = ['-m', 'pip', 'install', 'ultralytics', 'Pillow', 'requests', '--no-warn-script-location'];
    const pipProc = trackChild(spawn(pythonCmd, pipArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }));

    let stdout = '';
    let stderr = '';
    pipProc.stdout.on('data', (d) => { stdout += d.toString(); });
    pipProc.stderr.on('data', (d) => { stderr += d.toString(); });

    pipProc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });

    pipProc.on('error', (err) => {
      resolve({ success: false, stdout, stderr: err.message });
    });
  });
}

// ==========================================
// 应用生命周期
// ==========================================
app.whenReady().then(async () => {
  // 启动前检测 Python 依赖
  let checkResult = await checkPythonDependencies();
  let missing = checkResult.missing;

  // 诊断测试：AUTO_START=1 时跳过 Python 弹窗
  if (process.env.AUTO_START === '1') {
    missing = [];
  }

  // 如果存在缺失依赖，进入交互式处理流程
  while (missing.length > 0) {
    const allPythons = checkResult.allPythons || [];
    const currentCmd = checkResult.pythonCmd || '无';
    const currentVersion = allPythons.find(p => p.cmd === currentCmd)?.version || '?';

    // 构建弹窗详情文本
    let detail = '';

    // 显示所有检测到的 Python 及其包状态
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

    // 构建按钮
    const buttons = [];
    const buttonActions = [];

    // 如果有其他包齐全的 Python，提供切换选项
    for (const p of allPythons) {
      if (p.cmd === currentCmd) continue;
      const pkgs = getPythonPackagesStatus(p.cmd);
      const allInstalled = pkgs.every(pkg => pkg.installed);
      if (allInstalled) {
        buttons.push(`切换到 ${p.cmd} (${p.version})`);
        buttonActions.push({ type: 'switch', cmd: p.cmd });
      }
    }

    // 如果当前 Python 存在，提供安装选项
    if (checkResult.pythonCmd) {
      buttons.push(`在 ${currentCmd} 安装依赖`);
      buttonActions.push({ type: 'install' });
    }

    buttons.push('手动指定 Python 路径');
    buttonActions.push({ type: 'browse' });

    buttons.push('仍要启动');
    buttonActions.push({ type: 'skip' });

    buttons.push('退出');
    buttonActions.push({ type: 'quit' });

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
      // 用户选择切换到另一个 Python
      saveSettings({ ...loadSettings(), preferredPython: action.cmd });
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
      // 切换后仍有缺失，继续循环
      continue;
    }

    if (action.type === 'browse') {
      // 用户手动选择 Python 路径
      const { filePaths } = await dialog.showOpenDialog({
        title: '选择 Python 可执行文件',
        properties: ['openFile'],
        filters: [
          { name: 'Python 可执行文件', extensions: ['exe'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!filePaths || filePaths.length === 0) {
        continue; // 用户取消，回到弹窗
      }
      const customPath = filePaths[0];
      // 验证选择的文件
      try {
        const result = require('child_process').spawnSync(customPath, ['--version'], { encoding: 'utf-8', timeout: 3000 });
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
      // 保存自定义路径
      saveSettings({ ...loadSettings(), preferredPython: customPath });
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
      // 在当前 Python 安装依赖
      const installing = dialog.showMessageBox({
        type: 'info',
        title: '正在安装',
        message: `正在通过 pip 安装依赖到 ${checkResult.pythonCmd}...`,
        detail: ' ultralytics\n Pillow\n requests\n\n请稍候，安装完成后将自动检测。',
        buttons: [],
      });

      const result = await autoInstallDeps(checkResult.pythonCmd);

      installing.then(() => {}).catch(() => {});

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
        } else {
          await dialog.showMessageBox({
            type: 'warning',
            title: '安装完成',
            message: '依赖安装结束，但仍有缺失项：',
            detail: missing.join('\n') + '\n\n请手动执行安装命令排查。',
            buttons: ['确定'],
          });
          continue;
        }
      } else {
        await dialog.showMessageBox({
          type: 'error',
          title: '安装失败',
          message: 'pip 安装失败，请手动安装。',
          detail: '请打开命令行执行以下命令：\n' +
            `${checkResult.pythonCmd} -m pip install ultralytics Pillow requests\n\n错误信息：\n${result.stderr.slice(-500)}`,
          buttons: ['确定'],
        });
        continue;
      }
    }
  }

  createWindow();
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
