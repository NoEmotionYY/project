#!/usr/bin/env node
/**
 * 检测系统诊断脚本
 * 用于排查 AI 技能加载和检测功能问题
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const REQUIREMENTS_FILE = path.join(PROJECT_ROOT, 'requirements.txt');

console.log('='.repeat(60));
console.log('🔍 CYPHER 检测系统诊断工具');
console.log('='.repeat(60));
console.log();

let hasError = false;
let warnings = [];

// 1. 检查 Python 是否可用
console.log('1️⃣  检查 Python 环境...');
const pythonCheck = spawnSync('python', ['--version'], { encoding: 'utf-8' });
if (pythonCheck.status === 0 || pythonCheck.error) {
  const version = pythonCheck.stdout.trim() || pythonCheck.stderr.trim();
  console.log(`   ✅ Python 可用: ${version}`);
} else {
  console.log('   ❌ Python 未找到，请安装 Python 3.8+');
  hasError = true;
}
console.log();

// 2. 检查 Python 依赖
console.log('2️⃣  检查 Python 依赖...');
const requiredPackages = [
  { name: 'ultralytics', importName: 'ultralytics' },
  { name: 'Pillow', importName: 'PIL' },
  { name: 'numpy', importName: 'numpy' }
];

for (const pkg of requiredPackages) {
  const check = spawnSync('python', ['-c', `import ${pkg.importName}; print(${pkg.importName}.__version__)`], { 
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  if (check.status === 0) {
    const version = check.stdout.trim();
    console.log(`   ✅ ${pkg.name}: ${version}`);
  } else {
    console.log(`   ❌ ${pkg.name}: 未安装`);
    if (check.stderr) {
      console.log(`      错误: ${check.stderr.substring(0, 100)}`);
    }
    hasError = true;
  }
}
console.log();

// 3. 检查 YOLO 模型文件
console.log('3️⃣  检查 YOLO 模型文件...');
const modelFiles = [
  'best.pt',
  'best_helmet_vest.pt',
  'best_fire.pt'
];

for (const model of modelFiles) {
  const modelPath = path.join(SKILLS_DIR, model);
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`   ✅ ${model}: ${sizeMB} MB`);
  } else {
    console.log(`   ⚠️  ${model}: 不存在`);
    warnings.push(`模型文件 ${model} 缺失，将使用默认模型 yolov8n.pt（精度较低）`);
  }
}
console.log();

// 4. 检查技能配置文件
console.log('4️⃣  检查技能配置...');
const stateFile = path.join(SKILLS_DIR, 'skills-state.json');
if (fs.existsSync(stateFile)) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const enabledSkills = Object.entries(state).filter(([_, v]) => v === true);
    console.log(`   ✅ 已启用 ${enabledSkills.length} 个技能:`);
    enabledSkills.forEach(([name]) => {
      console.log(`      - ${name}`);
    });
    
    // 检查关键技能是否启用
    const criticalSkills = ['yolo-safety', 'audio-detector'];
    for (const skill of criticalSkills) {
      if (!state[skill]) {
        warnings.push(`关键技能 "${skill}" 未启用，请在设置页面启用`);
      }
    }
  } catch (e) {
    console.log(`   ❌ 技能状态文件损坏: ${e.message}`);
    hasError = true;
  }
} else {
  console.log('   ⚠️  技能状态文件不存在，将使用默认配置');
  warnings.push('skills-state.json 不存在，首次启动时将创建默认配置');
}
console.log();

// 5. 检查 .env 配置
console.log('5️⃣  检查环境变量配置...');
const envFile = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  
  // 检查 YOLO 模型配置
  const yoloModelMatch = envContent.match(/CYPHER_YOLO_MODEL=(.*)/);
  if (yoloModelMatch && yoloModelMatch[1].trim()) {
    const modelPath = path.join(PROJECT_ROOT, yoloModelMatch[1].trim());
    if (fs.existsSync(modelPath)) {
      console.log(`   ✅ CYPHER_YOLO_MODEL 配置正确`);
    } else {
      console.log(`   ⚠️  CYPHER_YOLO_MODEL 指向的文件不存在: ${yoloModelMatch[1].trim()}`);
      warnings.push('YOLO 模型路径配置错误');
    }
  } else {
    console.log('   ℹ️  CYPHER_YOLO_MODEL 未配置，将使用默认模型');
  }
  
  // 检查 API Key
  const apiKeyMatch = envContent.match(/QWEN_API_KEY=(.*)/);
  if (apiKeyMatch && apiKeyMatch[1].trim()) {
    console.log(`   ✅ Qwen API Key 已配置`);
  } else {
    console.log('   ℹ️  Qwen API Key 未配置（可选，仅影响 Qwen-VL 功能）');
  }
} else {
  console.log('   ⚠️  .env 文件不存在');
  warnings.push('.env 文件缺失，请从 .env.example 复制并配置');
}
console.log();

// 6. 测试 YOLO 导入
console.log('6️⃣  测试 YOLO 模块导入...');
const yoloTest = spawnSync('python', ['-c', 'from ultralytics import YOLO; print("OK")'], {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe']
});

if (yoloTest.status === 0 && yoloTest.stdout.trim() === 'OK') {
  console.log('   ✅ ultralytics.YOLO 导入成功');
} else {
  console.log('   ❌ ultralytics.YOLO 导入失败');
  if (yoloTest.stderr) {
    console.log(`   错误信息: ${yoloTest.stderr.substring(0, 200)}`);
  }
  hasError = true;
}
console.log();

// 7. 检查端口占用
console.log('7️⃣  检查端口占用...');
const net = require('net');
const checkPort = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false); // 端口被占用
    });
    server.once('listening', () => {
      server.close();
      resolve(true); // 端口可用
    });
    server.listen(port);
  });
};

(async () => {
  const ports = [8082, 8443];
  for (const port of ports) {
    const available = await checkPort(port);
    if (available) {
      console.log(`   ✅ 端口 ${port} 可用`);
    } else {
      console.log(`   ⚠️  端口 ${port} 已被占用`);
      warnings.push(`端口 ${port} 被其他程序占用，请关闭相关进程或修改配置`);
    }
  }
  console.log();
  
  // 总结
  console.log('='.repeat(60));
  console.log('📊 诊断结果总结');
  console.log('='.repeat(60));
  
  if (hasError) {
    console.log('❌ 发现严重错误，检测功能可能无法正常工作！');
    console.log();
    console.log('建议操作:');
    console.log('  1. 安装缺失的 Python 依赖: pip install -r requirements.txt');
    console.log('  2. 检查模型文件是否存在于 skills/ 目录');
    console.log('  3. 查看详细错误日志: logs/server.log');
  } else if (warnings.length > 0) {
    console.log('⚠️  发现以下警告（可能影响功能但不阻止运行）:');
    warnings.forEach((w, i) => {
      console.log(`   ${i + 1}. ${w}`);
    });
    console.log();
    console.log('✅ 核心功能应该可以正常工作');
  } else {
    console.log('✅ 所有检查通过！检测系统应该正常工作。');
  }
  
  console.log();
  console.log('如需更多帮助，请查看:');
  console.log('  - README.md');
  console.log('  - logs/server.log');
  console.log('='.repeat(60));
})();
