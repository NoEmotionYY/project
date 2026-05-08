const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const net = require('net');
const path = require('path');

const args = process.argv.slice(2);
const skipNginx = args.includes('--skip-nginx') || args.includes('--only-backend');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      })
      .on('error', reject);
  });
}

function stopChild(child, name) {
  if (!child || child.killed || !child.pid) return;
  try {
    child.kill();
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true
      });
    }
  } catch (err) {
    console.warn(`[cleanup] failed to stop ${name}: ${err.message}`);
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function stopNginxPrefix(nginxDir, confPath) {
  const nginxExe = path.join(nginxDir, 'bin', 'nginx-win.exe');
  try {
    const stopper = spawn(nginxExe, ['-p', nginxDir, '-c', confPath, '-s', 'stop'], {
      stdio: 'ignore',
      windowsHide: true
    });
    return stopper;
  } catch (err) {
    console.warn(`[cleanup] failed to stop nginx prefix: ${err.message}`);
    return null;
  }
}

function ensureNginxRuntimeDirs(nginxDir) {
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
    fs.mkdirSync(path.join(nginxDir, dir), { recursive: true });
  }
}

function writeTestNginxConf(nginxDir, nodePort, nginxPort) {
  const source = fs.readFileSync(path.join(nginxDir, 'conf', 'nginx.conf'), 'utf8');
  const conf = source
    .replace(/listen\s+\d+\s+ssl;/, `listen       ${nginxPort} ssl;`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/api\/events/g, `https://127.0.0.1:${nodePort}/api/events`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/api\//g, `https://127.0.0.1:${nodePort}/api/`)
    .replace(/https:\/\/127\.0\.0\.1:\d+\/offer/g, `https://127.0.0.1:${nodePort}/offer`);
  const confPath = path.join(nginxDir, 'conf', `nginx-test-${process.pid}.conf`);
  fs.writeFileSync(confPath, conf, 'utf8');
  return confPath;
}

async function main() {
  console.log('========================================');
  console.log('CYPHER system integration test');
  if (skipNginx) console.log('(backend-only mode, nginx skipped)');
  console.log('========================================\n');

  const nodePort = Number(process.env.CYPHER_TEST_NODE_PORT || await findAvailablePort(19082));
  const nginxPort = Number(process.env.CYPHER_TEST_NGINX_PORT || await findAvailablePort(19443));
  console.log(`[ports] node=${nodePort}, nginx=${nginxPort}`);

  console.log('[1/5] starting Node backend...');
  const server = spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(nodePort),
      LOG_DIR: __dirname,
      CERT_PATH: path.join(__dirname, '..', 'cert.pem'),
      KEY_PATH: path.join(__dirname, '..', 'key.pem')
    }
  });
  server.stdout.on('data', (data) => process.stdout.write(`[SERVER] ${data}`));
  server.stderr.on('data', (data) => process.stdout.write(`[SERVER-ERR] ${data}`));

  let nginx = null;
  let nginxConfPath = null;
  if (!skipNginx) {
    console.log('[2/5] starting nginx...');
    const nginxDir = path.join(__dirname, '..', 'nginx');
    ensureNginxRuntimeDirs(nginxDir);
    nginxConfPath = writeTestNginxConf(nginxDir, nodePort, nginxPort);
    await new Promise((resolve) => setTimeout(resolve, 500));
    nginx = spawn(
      path.join(nginxDir, 'bin', 'nginx-win.exe'),
      ['-p', nginxDir, '-c', nginxConfPath],
      { stdio: 'pipe' }
    );
    nginx.stdout.on('data', (data) => process.stdout.write(`[NGINX] ${data}`));
    nginx.stderr.on('data', (data) => process.stdout.write(`[NGINX-ERR] ${data}`));
  } else {
    console.log('[2/5] nginx skipped');
  }

  console.log('[3/5] waiting for services (3.5s)...\n');
  await new Promise((resolve) => setTimeout(resolve, 3500));

  console.log('[4/5] checking endpoints...\n');
  const checks = [
    { name: 'Node home page', url: `https://127.0.0.1:${nodePort}/` },
    { name: 'Node monitor compatibility page', url: `https://127.0.0.1:${nodePort}/monitor` },
    { name: 'Node events page', url: `https://127.0.0.1:${nodePort}/events` },
    { name: 'Node settings page', url: `https://127.0.0.1:${nodePort}/settings` },
    { name: 'Node dashboard page', url: `https://127.0.0.1:${nodePort}/dashboard` },
    { name: 'Node API /api/info', url: `https://127.0.0.1:${nodePort}/api/info` }
  ];

  if (!skipNginx) {
    checks.push(
      { name: 'nginx home page', url: `https://127.0.0.1:${nginxPort}/` },
      { name: 'nginx monitor compatibility page', url: `https://127.0.0.1:${nginxPort}/monitor` },
      { name: 'nginx events page', url: `https://127.0.0.1:${nginxPort}/events` },
      { name: 'nginx settings page', url: `https://127.0.0.1:${nginxPort}/settings` },
      { name: 'nginx dashboard page', url: `https://127.0.0.1:${nginxPort}/dashboard` },
      { name: 'nginx API proxy /api/info', url: `https://127.0.0.1:${nginxPort}/api/info` }
    );
  }

  let passed = 0;
  let failed = 0;
  for (const check of checks) {
    try {
      const response = await httpGet(check.url);
      const ok = response.status >= 200 && response.status < 400;
      console.log(`${ok ? 'OK' : 'FAIL'} ${check.name}: HTTP ${response.status}`);
      if (ok) passed += 1;
      else failed += 1;
    } catch (err) {
      console.log(`FAIL ${check.name}: ${err.message}`);
      failed += 1;
    }
  }

  console.log('\n[5/5] checking dashboard main page semantics...\n');
  try {
    const testUrl = skipNginx ? `https://127.0.0.1:${nodePort}/dashboard` : `https://127.0.0.1:${nginxPort}/dashboard`;
    const response = await httpGet(testUrl);
    const forbiddenBackend = ['127', '.0.0.1', ':8000'].join('');
    const forbiddenVideo = ['/video', '_feed'].join('');
    const hasDashboardTitle = response.data.includes('CYPHER 威胁感知中心');
    const hasAnalysisPanel = response.data.includes('analysis-content') && response.data.includes('updateAnalysisDisplay');
    const hasSkillModal = response.data.includes('技能管理') && response.data.includes('/api/skills/toggle');
    const backendSemanticsSafe =
      response.data.includes('BACKEND_URL') &&
      response.data.includes('/api/events') &&
      !response.data.includes(forbiddenBackend) &&
      !response.data.includes(forbiddenVideo);
    const apiSemanticsSafe =
      response.data.includes('/api/events') &&
      response.data.includes('/api/analysis') &&
      response.data.includes('/api/frame') &&
      response.data.includes('/api/cameras') &&
      !response.data.includes(forbiddenBackend) &&
      !response.data.includes(forbiddenVideo);

    console.log(`${hasDashboardTitle ? 'OK' : 'FAIL'} dashboard is the main UI`);
    console.log(`${hasAnalysisPanel ? 'OK' : 'FAIL'} dashboard contains AI analysis panel`);
    console.log(`${hasSkillModal ? 'OK' : 'FAIL'} dashboard contains skill management modal`);
    console.log(`${apiSemanticsSafe ? 'OK' : 'FAIL'} dashboard API semantics are safe`);
    if (hasDashboardTitle) passed += 1;
    else failed += 1;
    if (hasAnalysisPanel) passed += 1;
    else failed += 1;
    if (hasSkillModal) passed += 1;
    else failed += 1;
    if (backendSemanticsSafe || apiSemanticsSafe) passed += 1;
    else failed += 1;
  } catch (err) {
    console.log(`FAIL dashboard page content check: ${err.message}`);
    failed += 4;
  }

  console.log('\n========================================');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  console.log('\n[cleanup] stopping child processes...');
  stopChild(server, 'Node backend');
  if (nginx) {
    stopChild(nginx, 'nginx');
    const nginxDir = path.join(__dirname, '..', 'nginx');
    stopNginxPrefix(nginxDir, nginxConfPath);
    if (nginxConfPath && fs.existsSync(nginxConfPath)) {
      try { fs.unlinkSync(nginxConfPath); } catch (_) {}
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('test failed:', err);
  process.exit(1);
});
