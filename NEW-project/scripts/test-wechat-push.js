/**
 * 企业微信推送集成测试脚本
 * 
 * 使用方法：
 * node scripts/test-wechat-push.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN = process.env.PYTHON_PATH || process.env.PYTHON || 'python';
const WECHAT_PUSH_PATH = path.join(PROJECT_ROOT, 'skills', 'wechat-push.py');

console.log('='.repeat(60));
console.log('企业微信推送集成测试');
console.log('='.repeat(60));

// 检查文件是否存在
if (!fs.existsSync(WECHAT_PUSH_PATH)) {
  console.error('❌ wechat-push.py 不存在:', WECHAT_PUSH_PATH);
  process.exit(1);
}

console.log('✅ wechat-push.py 文件存在');
console.log('📍 路径:', WECHAT_PUSH_PATH);
console.log();

// 启动 Python 进程
console.log('🚀 启动 wechat-push.py...');
const proc = spawn(PYTHON_BIN, [WECHAT_PUSH_PATH], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1'
  }
});

let isReady = false;
let readBuffer = '';

proc.stdout.on('data', (data) => {
  readBuffer += data.toString();
  const lines = readBuffer.split('\n');
  readBuffer = lines.pop();
  
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log('[Python]', line);
    
    try {
      const response = JSON.parse(line);
      if (response.status === 'ready') {
        isReady = true;
        console.log('✅ Python 进程已就绪');
        console.log();
        
        // 测试开机通知
        console.log('📤 测试 1: 发送开机通知...');
        proc.stdin.write(JSON.stringify({ action: 'startup' }) + '\n');
        
        // 2秒后测试告警推送
        setTimeout(() => {
          console.log();
          console.log('📤 测试 2: 发送告警推送...');
          proc.stdin.write(JSON.stringify({
            action: 'send_alert',
            title: '测试告警',
            description: '这是一条测试告警消息',
            camera: '测试摄像头',
            time: new Date().toLocaleString('zh-CN', { hour12: false })
          }) + '\n');
          
          // 3秒后关闭
          setTimeout(() => {
            console.log();
            console.log('🔚 测试完成，关闭进程...');
            proc.stdin.write(JSON.stringify({ shutdown: true }) + '\n');
            setTimeout(() => {
              proc.kill();
              console.log('✅ 所有测试完成');
              process.exit(0);
            }, 1000);
          }, 3000);
        }, 2000);
      } else if (response.result) {
        console.log('✅ 收到响应:', response.result.text);
      }
    } catch (e) {
      console.error('❌ 解析响应失败:', e.message);
    }
  }
});

proc.stderr.on('data', (data) => {
  console.error('[Python Error]', data.toString().trim());
});

proc.on('error', (err) => {
  console.error('❌ 启动失败:', err.message);
  process.exit(1);
});

proc.on('close', (code) => {
  console.log(`[Python] 进程退出 (code ${code})`);
  if (!isReady) {
    console.error('❌ 进程在就绪前退出');
    process.exit(1);
  }
});

// 超时保护
setTimeout(() => {
  console.error('❌ 测试超时');
  proc.kill();
  process.exit(1);
}, 15000);
