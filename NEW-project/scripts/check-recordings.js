const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('录制文件检查');
console.log('='.repeat(70));

// 录制目录
const RECORD_DIR = path.join(__dirname, '..', 'recordings');

if (!fs.existsSync(RECORD_DIR)) {
  console.log('✗ 录制目录不存在:', RECORD_DIR);
  process.exit(1);
}

console.log('✓ 录制目录存在:', RECORD_DIR);
console.log();

// 列出所有摄像头目录
const cameraDirs = fs.readdirSync(RECORD_DIR);
console.log(`找到 ${cameraDirs.length} 个摄像头目录:`);

cameraDirs.forEach(camDir => {
  const camPath = path.join(RECORD_DIR, camDir);
  if (!fs.statSync(camPath).isDirectory()) return;
  
  console.log(`\n摄像头: ${camDir}`);
  
  const files = fs.readdirSync(camPath);
  const mkvFiles = files.filter(f => f.endsWith('.mkv'));
  
  console.log(`  MKV 文件数量: ${mkvFiles.length}`);
  
  if (mkvFiles.length > 0) {
    mkvFiles.forEach(file => {
      const filePath = path.join(camPath, file);
      const stat = fs.statSync(filePath);
      console.log(`  - ${file}`);
      console.log(`    大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`    创建时间: ${stat.birthtime.toLocaleString('zh-CN')}`);
      console.log(`    修改时间: ${stat.mtime.toLocaleString('zh-CN')}`);
    });
  } else {
    console.log('  (无 MKV 文件)');
  }
});

console.log();
console.log('='.repeat(70));
