/**
 * 录像功能诊断脚本
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('录像功能诊断');
console.log('='.repeat(70));
console.log();

// 检查 FFmpeg
console.log('1. 检查 FFmpeg...');
try {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg');
  console.log(`   ✓ FFmpeg 路径: ${ffmpeg.path}`);
  
  // 验证文件是否存在
  if (fs.existsSync(ffmpeg.path)) {
    console.log(`   ✓ FFmpeg 文件存在`);
  } else {
    console.log(`   ✗ FFmpeg 文件不存在！`);
  }
} catch (e) {
  console.log(`   ✗ 无法加载 @ffmpeg-installer/ffmpeg: ${e.message}`);
  console.log(`   ℹ 将尝试使用系统 PATH 中的 ffmpeg`);
}
console.log();

// 检查录制目录
console.log('2. 检查录制目录...');
const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');
if (fs.existsSync(RECORDINGS_DIR)) {
  console.log(`   ✓ 录制目录存在: ${RECORDINGS_DIR}`);
  
  const cameras = fs.readdirSync(RECORDINGS_DIR).filter(f => {
    return fs.statSync(path.join(RECORDINGS_DIR, f)).isDirectory();
  });
  
  console.log(`   ℹ 找到 ${cameras.length} 个摄像头目录:`);
  cameras.forEach(cam => {
    const camDir = path.join(RECORDINGS_DIR, cam);
    const files = fs.readdirSync(camDir).filter(f => f.endsWith('.mkv'));
    console.log(`      - ${cam}: ${files.length} 个文件`);
  });
} else {
  console.log(`   ✗ 录制目录不存在: ${RECORDINGS_DIR}`);
}
console.log();

// 测试 FFmpeg 录制
console.log('3. 测试 FFmpeg 录制功能...');
const testOutput = path.join(__dirname, '..', 'test-recording.mkv');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const args = [
  '-y',
  '-f', 'lavfi',
  '-i', 'testsrc=size=640x480:rate=5',
  '-t', '3',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-preset', 'ultrafast',
  '-crf', '28',
  testOutput
];

console.log(`   命令: ${ffmpegPath} ${args.join(' ')}`);

const proc = spawn(ffmpegPath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let stderr = '';
proc.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

proc.on('close', (code) => {
  if (code === 0 && fs.existsSync(testOutput)) {
    const stats = fs.statSync(testOutput);
    console.log(`   ✓ 测试录制成功！`);
    console.log(`   ℹ 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   ℹ 文件路径: ${testOutput}`);
    
    // 清理测试文件
    try {
      fs.unlinkSync(testOutput);
      console.log(`   ℹ 测试文件已清理`);
    } catch (e) {}
  } else {
    console.log(`   ✗ 测试录制失败 (退出码: ${code})`);
    console.log(`   错误信息:`);
    console.log(stderr.split('\n').slice(-5).join('\n'));
  }
  
  console.log();
  console.log('='.repeat(70));
  console.log('诊断完成');
  console.log('='.repeat(70));
});

proc.on('error', (err) => {
  console.log(`   ✗ FFmpeg 启动失败: ${err.message}`);
  console.log();
  console.log('建议解决方案:');
  console.log('1. 确保 FFmpeg 已正确安装');
  console.log('2. 检查 .env 文件中的 FFMPEG_PATH 配置');
  console.log('3. 如果 FFMPEG_PATH 为空，将自动使用系统 PATH 中的 ffmpeg');
});
