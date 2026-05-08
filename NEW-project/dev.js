/**
 * 开发模式一键启动脚本
 * 用法:
 *   node dev.js           启动后端 + nginx + 自动打开浏览器
 *   node dev.js --electron 启动后端 + nginx + Electron（测试桌面端）
 *
 * 改完代码直接运行此脚本，无需打包。
 * 按 Ctrl+C 一键关闭所有服务。
 */
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 解析参数
const args = process.argv.slice(2);
const withElectron = args.includes('--electron');

// ==========================================
// 配置
// ==========================================
const NODE_PORT = Number(process.env.NODE_PORT || process.env.PORT || 8082);
const NGINX_PORT = Number(process.env.NGINX_PORT || 8443);
const LOG_DIR = path.join(__dirname, 'logs');

// nginx 路径
const NGINX_DIR = path.join(__dirname, 'nginx');
const NGINX_BIN = path.join(NGINX_DIR, 'bin', (() => {
  const map = { win32: 'nginx-win.exe', darwin: 'nginx-mac', linux: 'nginx-linux' };
  return map[process.platform] || 'nginx-linux';
})());

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

// ==========================================
// 工具函数
// ==========================================
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// ==========================================
// 进程管理
// ==========================================
const processes = [];
let cleaningUp = false;

function register(proc, name) {
  processes.push({ proc, name });
  proc.on('exit', (code) => {
    const idx = processes.findIndex(p => p.proc === proc);
    if (idx >= 0) processes.splice(idx, 1);
    log(`${name} 已退出 (code=${code})`);
  });
}

function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;
  log('正在关闭所有服务...');
  for (const { proc, name } of [...processes]) {
    try {
      if (!proc || proc.killed || !proc.pid) continue;
      proc.kill();
      if (process.platform === 'win32') {
        spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore', windowsHide: true });
      }
      log(`已请求关闭 ${name} (pid=${proc.pid})`);
    } catch (e) {
      log(`关闭进程失败: ${e.message}`);
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const { findAvailablePort } = require('./src/port-utils');

// ==========================================
// 启动流程
// ==========================================
async function main() {
  log('============================================');
  log('真視眼 CYPHER - 开发模式启动');
  log('============================================');

  fs.mkdirSync(LOG_DIR, { recursive: true });
  ensureNginxRuntimeDirs();

  // 0. 检测端口
  log('[0/3] 检测端口...');
  let actualNodePort, actualNginxPort;
  try {
    actualNodePort = await findAvailablePort(NODE_PORT);
    actualNginxPort = await findAvailablePort(NGINX_PORT);
    log(`  Node.js 端口: ${actualNodePort}`);
    log(`  nginx 端口: ${actualNginxPort}`);
  } catch (e) {
    log(`[错误] ${e.message}`);
    process.exit(1);
  }

  // 动态生成 nginx 临时配置（替换端口）
  const nginxConfTemplate = fs.readFileSync(path.join(NGINX_DIR, 'conf', 'nginx.conf'), 'utf-8');
  const nginxConf = nginxConfTemplate
    .replace(/listen\s+\d+\s+ssl;/, `listen ${actualNginxPort} ssl;`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/api\/events/g, `https://127.0.0.1:${actualNodePort}/api/events`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/api\//g, `https://127.0.0.1:${actualNodePort}/api/`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/offer/g, `https://127.0.0.1:${actualNodePort}/offer`);
  const tempConfPath = path.join(NGINX_DIR, 'conf', 'nginx-temp.conf');
  fs.writeFileSync(tempConfPath, nginxConf);

  // 1. 启动 Node.js 后端
  log('[1/3] 启动 Node.js 后端...');
  const server = spawn('node', ['src/server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, LOG_DIR, ELECTRON_RUN: '1', PORT: String(actualNodePort), NODE_PORT: String(actualNodePort) }
  });
  register(server, 'Node.js 后端');

  // 2. 启动 nginx
  log('[2/3] 启动 nginx...');
  if (process.platform !== 'win32') {
    try { fs.chmodSync(NGINX_BIN, 0o755); } catch (_) {}
  }
  const nginx = spawn(NGINX_BIN, [
    '-p', NGINX_DIR,
    '-c', tempConfPath
  ], { stdio: 'inherit' });
  register(nginx, 'nginx');

  // 等待服务就绪
  log('等待服务就绪 (3s)...');
  await new Promise(r => setTimeout(r, 3500));

  const lanIp = getLanIp();

  // 3. 启动 Electron 或打开浏览器
  if (withElectron) {
    log('[3/3] 启动 Electron...');
    const electron = spawn('npx', ['electron', '.'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NGINX_PORT: String(actualNginxPort), NODE_PORT: String(actualNodePort) }
    });
    register(electron, 'Electron');
  } else {
    log('[3/3] 打开浏览器...');
    const url = `https://127.0.0.1:${actualNginxPort}/dashboard`;
    spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', windowsHide: true });
  }

  // 输出访问地址
  log('============================================');
  log('所有服务已启动！');
  log('');
  log('【本机调试】');
  log(`  https://127.0.0.1:${actualNodePort}/          (Node.js 直接访问)`);
  log(`  https://127.0.0.1:${actualNginxPort}/         (nginx 前端)`);
  log(`  https://127.0.0.1:${actualNginxPort}/dashboard  (主界面)`);
  log(`  https://127.0.0.1:${actualNginxPort}/monitor    (兼容入口)`);
  log('');
  log('【局域网访问 - 手机/其他电脑】');
  log(`  https://${lanIp}:${actualNginxPort}/          (手机推流)`);
  log(`  https://${lanIp}:${actualNginxPort}/dashboard   (主界面)`);
  log('');
  log('按 Ctrl+C 关闭所有服务');
  log('============================================');
}

main().catch(err => {
  console.error('启动失败:', err);
  cleanup();
});
