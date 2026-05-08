/**
 * 一键启动监控页
 * 用法: node monitor.js
 * 
 * 效果: 启动 Node.js 后端 → 2秒后自动打开浏览器访问 monitor
 */
const path = require('path');
const { spawn } = require('child_process');

console.log('[1/2] 启动后端...');
const server = spawn('node', [path.join(__dirname, 'server.js')], { stdio: 'inherit' });

setTimeout(() => {
  console.log('[2/2] 打开监控页 https://127.0.0.1:8082/monitor');
  spawn('cmd', ['/c', 'start', 'https://127.0.0.1:8082/monitor'], { stdio: 'ignore' });
}, 2500);

process.on('SIGINT', () => {
  server.kill();
  process.exit();
});
