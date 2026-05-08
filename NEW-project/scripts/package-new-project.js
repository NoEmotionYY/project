const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 'D:\\test\\NEW-project';
const targetDir = path.resolve(process.env.NEW_PROJECT_DIR || DEFAULT_TARGET);
const parentDir = path.dirname(targetDir);
const stagingDir = path.join(parentDir, path.basename(targetDir) + '-staging');

const rootFiles = [
  'package.json',
  'package-lock.json',
  'electron-main.js',
  'dev.js',
  'server.js',
  'requirements.txt',
  '.env.example',
  '.gitignore',
  'README.md'
];

const rootDirs = [
  'src',
  'skills',
  'scripts',
  'html',
  'nginx',
  'legacy',
  'tests'
];

const docsToCopy = [
  'CODEX_TASK_CONTEXT.md',
  'CODEX_RUNBOOK_CN.md',
  'CODEX_FULL_TEST_REPORT.md',
  'CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md'
];

const testsToKeep = new Set([
  'test-system.js',
  'test-round4-api-foundation.js',
  'test-round5-page-migration.js',
  'test-round6-e2e-validation.js',
  'test-yolo-safety-governance.py',
  'test-round9-camera-env-package-fix.js'
]);

const excludedRootNames = new Set([
  '.git',
  'node_modules',
  'bin',
  'data',
  'recordings',
  'camera-videos',
  'captures',
  'snapshots',
  'logs',
  'camera-logs',
  'dist',
  'build',
  'out',
  'release',
  'Vigil_AI_System',
  '.env'
]);

const excludedAnyNames = new Set([
  'node_modules',
  '.git',
  '.env',
  '__pycache__',
  'logs',
  'cert.pem',
  'key.pem',
  'openssl-test.cnf',
  'nginx.pid',
  'skills-state.json',
  'vigil_logs.db',
  'users.json'
]);

const copied = [];
const skipped = [];

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join('');
}

function assertSafeOutputDir(dir) {
  const resolved = path.resolve(dir);
  const base = path.resolve(parentDir);
  if (resolved === PROJECT_ROOT || PROJECT_ROOT.startsWith(resolved + path.sep)) {
    throw new Error('Refusing to package into the current project tree');
  }
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Output path must stay inside its parent directory');
  }
}

function shouldCopy(src, relative) {
  const parts = relative.split(path.sep);
  const name = path.basename(src);
  const lowerName = name.toLowerCase();
  if (parts.length === 1 && excludedRootNames.has(name)) return false;
  if (excludedAnyNames.has(name)) return false;
  if (relative.startsWith('nginx' + path.sep + 'logs' + path.sep)) return false;
  if (lowerName.endsWith('.pyc') || lowerName.endsWith('.pyo') || lowerName.endsWith('.log')) return false;
  if (relative.startsWith('nginx' + path.sep + 'conf' + path.sep) && /^(cert|key)\.pem$/i.test(name)) {
    return false;
  }
  if (relative.startsWith('tests' + path.sep) && !testsToKeep.has(name)) {
    return false;
  }
  return true;
}

function copyRecursive(src, dest, relative = '') {
  if (!fs.existsSync(src)) {
    skipped.push(relative || src);
    return;
  }
  if (!shouldCopy(src, relative || path.basename(src))) {
    skipped.push(relative || path.basename(src));
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      const childRel = relative ? path.join(relative, entry) : entry;
      copyRecursive(path.join(src, entry), path.join(dest, entry), childRel);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(relative || path.basename(src));
  }
}

function copySelectedDocs() {
  const docsSrc = path.join(PROJECT_ROOT, 'docs');
  const docsDest = path.join(stagingDir, 'docs');
  fs.mkdirSync(docsDest, { recursive: true });
  for (const doc of docsToCopy) {
    const src = path.join(docsSrc, doc);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(docsDest, doc));
      copied.push(path.join('docs', doc));
    } else {
      skipped.push(path.join('docs', doc));
    }
  }
}

function writeManifest() {
  const manifest = [
    '# CYPHER packaged project manifest',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Source: ${PROJECT_ROOT}`,
    `Target: ${targetDir}`,
    '',
    '## Copied files',
    '',
    ...copied.sort().map(item => '- ' + item.replace(/\\/g, '/')),
    '',
    '## Excluded by policy',
    '',
    '- .git/',
    '- node_modules/',
    '- bin/',
    '- data/',
    '- recordings/',
    '- logs/',
    '- .env',
    '- Vigil_AI_System/',
    '- generated cert.pem/key.pem',
    '- vigil_logs.db / users.json',
    '',
    '## Missing optional files',
    '',
    ...(skipped.length ? skipped.sort().map(item => '- ' + item.replace(/\\/g, '/')) : ['- None'])
  ].join('\n');
  fs.writeFileSync(path.join(stagingDir, 'MANIFEST.md'), manifest, 'utf8');

  const runbook = [
    '# Run packaged CYPHER project',
    '',
    '1. Install dependencies:',
    '   npm install',
    '2. Create local env:',
    '   copy .env.example .env',
    '3. Prepare local HTTPS cert:',
    '   node scripts/ensure-test-cert.js',
    '4. Start development runtime:',
    '   npm run dev',
    '',
    'Main UI: https://127.0.0.1:8443/dashboard',
    'Camera sender: https://127.0.0.1:8443/',
    '',
    'Do not commit .env, data/, recordings/, snapshots, cert.pem, or key.pem.'
  ].join('\n');
  fs.writeFileSync(path.join(stagingDir, 'RUN_NEW_PROJECT.md'), runbook, 'utf8');
}

function main() {
  assertSafeOutputDir(targetDir);
  fs.mkdirSync(parentDir, { recursive: true });
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const file of rootFiles) {
    copyRecursive(path.join(PROJECT_ROOT, file), path.join(stagingDir, file), file);
  }
  for (const dir of rootDirs) {
    copyRecursive(path.join(PROJECT_ROOT, dir), path.join(stagingDir, dir), dir);
  }
  if (fs.existsSync(path.join(PROJECT_ROOT, 'models'))) {
    copyRecursive(path.join(PROJECT_ROOT, 'models'), path.join(stagingDir, 'models'), 'models');
  }
  if (fs.existsSync(path.join(PROJECT_ROOT, 'yolov8n.pt'))) {
    copyRecursive(path.join(PROJECT_ROOT, 'yolov8n.pt'), path.join(stagingDir, 'yolov8n.pt'), 'yolov8n.pt');
  }
  copySelectedDocs();
  writeManifest();

  if (fs.existsSync(targetDir)) {
    const backupDir = targetDir + '-backup-' + timestamp();
    fs.renameSync(targetDir, backupDir);
    console.log('[package] existing target moved to ' + backupDir);
  }
  fs.renameSync(stagingDir, targetDir);
  console.log('[package] packaged project written to ' + targetDir);
  console.log('[package] copied=' + copied.length + ' skipped=' + skipped.length);
}

main();
