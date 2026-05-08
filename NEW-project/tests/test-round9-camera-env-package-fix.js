const assert = require('assert');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_PORT = Number(process.env.CYPHER_ROUND9_PORT || 19182);
const BASE_URL = `https://127.0.0.1:${TEST_PORT}`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function p(...parts) {
  return parts.join('');
}

function assertAbsent(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(!source.includes(token), `${label} should not contain ${token}`);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request(
      `${BASE_URL}${urlPath}`,
      {
        method,
        rejectUnauthorized: false,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          const text = bodyBuffer.toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: bodyBuffer, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 12000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await request('GET', '/api/info');
      if (res.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw lastError || new Error('server did not become ready');
}

async function stopChild(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  const exited = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited && child.pid && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}

function staticChecks() {
  const webrtc = read('html/webrtc-client.html');
  const desktop = read('html/desktop-capture.html');
  const dashboard = read('html/dashboard.html');
  const settings = read('html/settings.html');
  const envExample = read('.env.example');
  const gitignore = read('.gitignore');
  const srcServer = read('src/server.js');
  const rootServer = read('server.js');
  const dev = read('dev.js');
  const electron = read('electron-main.js');
  const qwen = read('skills/qwen-vl.js');
  const packageScript = read('scripts/package-new-project.js');

  for (const [name, source] of [['webrtc', webrtc], ['desktop', desktop]]) {
    assert.ok(source.includes('getPeerConnectionConstructor'), `${name} should resolve native PeerConnection safely`);
    assert.ok(source.includes("typeof PeerConnection !== 'function'"), `${name} should guard PeerConnection type`);
    assert.ok(!source.includes('new RTCPeerConnection('), `${name} should not directly construct RTCPeerConnection`);
    assert.ok(!source.includes('window.RTCPeerConnection ='), `${name} should not overwrite native RTCPeerConnection`);
  }

  assert.ok(dashboard.includes('/api/frame'), 'dashboard should use /api/frame');
  assert.ok(dashboard.includes('/api/cameras'), 'dashboard should use /api/cameras');
  assert.ok(dashboard.includes('/api/cameras/${encodeURIComponent(activeCameraId)}/frame'), 'dashboard should use camera frame endpoint');
  assertAbsent(dashboard, [p('/video', '_feed')], 'dashboard');

  assert.ok(settings.includes('camera-source-type'), 'settings should include camera source type UI');
  assert.ok(settings.includes('camera-url'), 'settings should include camera url UI');
  assert.ok(settings.includes('/api/cameras'), 'settings should use cameras API');
  assert.ok(settings.includes('/api/cameras/active'), 'settings should set active camera through CYPHER API');
  assert.ok(settings.includes("endpoint += '/start'"), 'settings should start camera through cameras API');
  assert.ok(settings.includes("endpoint += '/stop'"), 'settings should stop camera through cameras API');
  assertAbsent(settings, [p('/camera', '_config'), p('/test', '_camera'), p('/video', '_feed')], 'settings');

  assert.ok(envExample.includes('NODE_PORT=8082'), '.env.example should include NODE_PORT');
  assert.ok(envExample.includes('NGINX_PORT=8443'), '.env.example should include NGINX_PORT');
  assert.ok(envExample.includes('DASHSCOPE_API_KEY='), '.env.example should include DashScope key placeholder');
  assert.ok(envExample.includes('DEFAULT_RTSP_URL='), '.env.example should include default camera placeholder');
  assert.ok(!/sk-[A-Za-z0-9]/.test(envExample), '.env.example should not include real keys');
  assert.ok(/(^|\n)\.env(\n|$)/.test(gitignore), '.gitignore should ignore .env');
  assert.ok(gitignore.includes('data/'), '.gitignore should ignore runtime data');
  assert.ok(gitignore.includes('data/cameras.json'), '.gitignore should explicitly mention camera config');

  for (const [name, source] of [['src/server.js', srcServer], ['server.js', rootServer], ['dev.js', dev], ['electron-main.js', electron], ['qwen-vl.js', qwen]]) {
    assert.ok(source.includes('dotenv'), `${name} should load dotenv`);
  }

  assert.ok(srcServer.includes('camera-config-store'), 'server should use camera config store');
  assert.ok(srcServer.includes('maskCameraUrl'), 'server should mask camera URLs');
  assert.ok(srcServer.includes('activeCameraId = camId'), 'server should activate new WebRTC camera');

  for (const token of ['node_modules', '.git', 'bin', 'data', 'recordings', 'Vigil_AI_System']) {
    assert.ok(packageScript.includes(token), `package script should mention ${token} exclusion`);
  }
}

async function webrtcFrameIntegration() {
  spawnSync(process.execPath, ['scripts/ensure-test-cert.js'], { cwd: ROOT, stdio: 'inherit' });
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_PORT: String(TEST_PORT),
      ELECTRON_RUN: '1',
      LOG_DIR: path.join(ROOT, 'logs'),
      CYPHER_TEST_FRAME_ENDPOINT: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
  server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

  try {
    await waitForServer();
    const width = 4;
    const height = 4;
    const frame = Buffer.alloc(width * height * 1.5, 128);
    const injected = await request('POST', '/api/test/frame', {
      cameraId: 'round9-test-camera',
      width,
      height,
      data: frame.toString('base64')
    });
    assert.strictEqual(injected.status, 200, 'test frame injection should succeed: ' + injected.text + '\n' + serverLog.slice(-1000));
    assert.strictEqual(injected.json.success, true, 'test frame injection should report success');
    assert.ok(injected.json.frameCount > 0, 'test frame should increment frameCount');

    let image = null;
    for (let i = 0; i < 20; i++) {
      const res = await request('GET', '/api/frame');
      if (res.status === 200 && /^image\/jpeg/.test(res.headers['content-type'] || '')) {
        image = res;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!image) {
      const camerasForDebug = await request('GET', '/api/cameras');
      throw new Error('/api/frame did not return image/jpeg; cameras=' + JSON.stringify(camerasForDebug.json));
    }
    assert.strictEqual(image.headers['x-camera-id'], 'round9-test-camera', 'active camera should switch to the frame source');

    const cameras = await request('GET', '/api/cameras');
    assert.strictEqual(cameras.status, 200, '/api/cameras should return 200');
    assert.ok(cameras.json.cameras.some(camera => camera.hasFrame), 'camera list should expose a camera with frame');
  } finally {
    await stopChild(server);
  }
}

(async () => {
  staticChecks();
  await webrtcFrameIntegration();
  console.log('Round9 camera/env/package tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
