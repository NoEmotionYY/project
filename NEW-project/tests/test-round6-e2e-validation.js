const assert = require('assert');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_PORT = Number(process.env.CYPHER_ROUND6_PORT || 19082);
const BASE_URL = `https://127.0.0.1:${TEST_PORT}`;
const PYTHON = process.env.PYTHON_PATH || process.env.PYTHON || 'python';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const foundation = require('../src/round4-api-foundation');

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
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            // Non-JSON responses are expected for pages and images.
          }
          resolve({ status: res.statusCode, headers: res.headers, body: buffer, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readSseFirstEvent(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${BASE_URL}${urlPath}`, { rejectUnauthorized: false }, (res) => {
      let data = '';
      const timeout = setTimeout(() => {
        req.destroy();
        reject(new Error('SSE timed out'));
      }, 5000);
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
        const match = data.match(/data:\s*(\{.*\})/);
        if (match) {
          clearTimeout(timeout);
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, payload: JSON.parse(match[1]) });
        }
      });
      res.on('end', () => {
        clearTimeout(timeout);
      });
    });
    req.on('error', (err) => {
      if (err.code !== 'ECONNRESET') reject(err);
    });
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited ${result.status}`);
  }
  return result.stdout;
}

function seedAlert() {
  const stdout = run(PYTHON, ['scripts/seed-test-alert.py']);
  return JSON.parse(stdout);
}

function insertSpecialAlert(snapshotPath) {
  const code = `
import json, sqlite3
from datetime import datetime, timezone
from pathlib import Path
root = Path.cwd()
db = root / "data" / "alerts.db"
db.parent.mkdir(parents=True, exist_ok=True)
now = datetime.now(timezone.utc)
conn = sqlite3.connect(db)
cur = conn.execute("""
INSERT INTO alerts (
  created_at, created_at_ms, camera_id, camera_label, category, category_cn,
  alert_type, title, severity, confidence, model_name, skill_id, message,
  snapshot_path, video_path, source_skill, reviewed_by_qwen, qwen_result, raw_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", (
  now.isoformat(), int(now.timestamp() * 1000), "test-cam", "测试摄像头",
  "ppe", "未戴安全帽", "no-helmet", "未戴安全帽", "warning", 0.88,
  "test-model.pt", "yolo-safety", "Round6 special alert",
  ${JSON.stringify(snapshotPath)}, None, "yolo-safety", 0, None,
  json.dumps({"alert": {"type": "no-helmet"}, "camera": {"id": "test-cam"}}, ensure_ascii=False)
))
conn.commit()
print(cur.lastrowid)
conn.close()
`;
  return Number(run(PYTHON, ['-c', code]).trim());
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not become ready')), 15000);
    const tick = async () => {
      if (child.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`server exited early with ${child.exitCode}`));
        return;
      }
      try {
        const response = await request('GET', '/api/info');
        if (response.status === 200) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch (_) {
        // Keep polling.
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function stopChild(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    child.kill();
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true
      });
    }
  } catch (_) {
    // Best-effort cleanup for the child process this test started.
  }
}

async function main() {
  run('node', ['scripts/ensure-test-cert.js']);
  const seeded = seedAlert();
  assert.ok(seeded.id, 'seed script should return an alert id');

  const existingConfigPath = path.join(ROOT, 'data', 'detection-config.json');
  const hadExistingConfig = fs.existsSync(existingConfigPath);
  const existingConfig = hadExistingConfig ? fs.readFileSync(existingConfigPath, 'utf8') : null;

  const server = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      CERT_PATH: path.join(ROOT, 'cert.pem'),
      KEY_PATH: path.join(ROOT, 'key.pem'),
      LOG_DIR: path.join(ROOT, 'logs')
    },
    windowsHide: true
  });

  try {
    await waitForServer(server);

    for (const route of ['/monitor', '/recordings', '/events', '/settings', '/dashboard']) {
      const response = await request('GET', route);
      assert.strictEqual(response.status, 200, `${route} should return 200`);
      assert.ok(response.text.includes('<html'), `${route} should return html`);
    }

    const eventsHtml = read('html/events.html');
    const settingsHtml = read('html/settings.html');
    const dashboardHtml = read('html/dashboard.html');
    const monitorCompatHtml = read('html/monitor.html');
    assertAbsent(eventsHtml, [p('/api/alerts/', 'recent'), p('/video', '_feed'), p('127.0.0.1', ':8000'), p('py', 'webview')], 'events page');
    assertAbsent(settingsHtml, [p('/camera', '_config'), p('/test', '_camera'), p('/api/model/', 'current'), p('/api/model/', 'switch')], 'settings page');
    assertAbsent(dashboardHtml, [p('/video', '_feed'), p('/api/alerts/', 'recent'), p('/camera', '_config'), p('127.0.0.1', ':8000')], 'dashboard page');
    assert.ok(eventsHtml.includes('/api/alerts'), 'events page should call alerts API');
    assert.ok(settingsHtml.includes('/api/detection/config'), 'settings page should call config API');
    assert.ok(dashboardHtml.includes('/api/events') && dashboardHtml.includes('/api/analysis'), 'dashboard page should use SSE and analysis APIs');
    assert.ok(dashboardHtml.includes('length > 20'), 'dashboard should cap alert cards at 20');
    assert.ok(/setInterval\(pollAnalysis,\s*3000\)/.test(dashboardHtml), 'dashboard fallback polling should be 3 seconds');
    assert.ok(dashboardHtml.includes('updateAnalysisDisplay'), 'dashboard should include AI analysis display');
    assert.ok(dashboardHtml.includes('/api/skills') && dashboardHtml.includes('/api/skills/toggle'), 'dashboard should include skill management APIs');
    assert.ok(monitorCompatHtml.includes('/dashboard'), 'monitor compatibility page should redirect to dashboard');
    assertAbsent(monitorCompatHtml, ['skill-sidebar', 'skill-file-input', 'analysis-section'], 'monitor compatibility page');

    for (const relPath of ['src/server.js', 'server.js']) {
      const source = read(relPath);
      for (const route of ['/monitor', '/recordings', '/events', '/settings', '/dashboard']) {
        assert.ok(source.includes(`app.get('${route}'`), `${relPath} should include ${route}`);
      }
      assert.ok(source.includes("app.get('/api/events'"), `${relPath} should keep SSE route`);
      assert.ok(source.includes('text/event-stream'), `${relPath} should keep SSE content type`);
    }

    const list = await request('GET', '/api/alerts?page=1&limit=50&category=ppe&severity=warning&q=Round6');
    assert.strictEqual(list.status, 200, 'alert list should return 200');
    assert.ok(list.json.success, 'alert list should succeed');
    assert.ok(list.json.items.some((item) => item.id === seeded.id), 'alert list should include seeded alert');
    assert.ok(!Object.prototype.hasOwnProperty.call(list.json.items[0], 'raw_json'), 'alert list should omit raw_json');

    const detail = await request('GET', `/api/alerts/${seeded.id}`);
    assert.strictEqual(detail.status, 200, 'alert detail should return 200');
    assert.strictEqual(detail.json.item.raw.alert.type, 'no-helmet');
    assert.ok(detail.json.item.raw_json, 'alert detail should include raw_json');

    const snapshot = await request('GET', `/api/alerts/${seeded.id}/snapshot`);
    assert.strictEqual(snapshot.status, 200, 'snapshot should return 200');
    assert.ok(String(snapshot.headers['content-type']).includes('image'), 'snapshot should be an image');

    const missingSnapshotId = insertSpecialAlert('data/snapshots/2099-01-01/missing.jpg');
    const missingSnapshot = await request('GET', `/api/alerts/${missingSnapshotId}/snapshot`);
    assert.strictEqual(missingSnapshot.status, 404, 'missing snapshot file should return 404');

    const traversalId = insertSpecialAlert('data/snapshots/../../secret.jpg');
    const traversal = await request('GET', `/api/alerts/${traversalId}/snapshot`);
    assert.strictEqual(traversal.status, 403, 'snapshot traversal should be rejected');

    const config = await request('GET', '/api/detection/config');
    assert.strictEqual(config.status, 200, 'config GET should return 200');
    for (const key of ['thresholds', 'confirmFrames', 'cooldowns', 'modelProfile', 'qwenReview', 'analysisIntervalMs']) {
      assert.ok(Object.prototype.hasOwnProperty.call(config.json.config, key), `config should include ${key}`);
    }
    assert.ok(!JSON.stringify(config.json).includes('API_KEY'), 'config response should not expose API key fields');

    const savedConfig = await request('POST', '/api/detection/config', {
      thresholds: { 'no-helmet': 0.66 },
      confirmFrames: { 'no-helmet': 4 },
      cooldowns: { fire: 12 },
      modelProfile: 'ppe',
      qwenReview: false,
      analysisIntervalMs: 1500
    });
    assert.strictEqual(savedConfig.status, 200, 'valid config POST should return 200');
    const configAfterSave = await request('GET', '/api/detection/config');
    assert.strictEqual(configAfterSave.json.config.thresholds['no-helmet'], 0.66);
    assert.strictEqual(configAfterSave.json.config.confirmFrames['no-helmet'], 4);
    assert.strictEqual(configAfterSave.json.config.modelProfile, 'ppe');

    const invalidThreshold = await request('POST', '/api/detection/config', { thresholds: { fire: 2 } });
    assert.strictEqual(invalidThreshold.status, 400, 'invalid threshold should be rejected');
    const invalidModel = await request('POST', '/api/detection/config', { modelProfile: 'C:/unsafe/model.pt' });
    assert.strictEqual(invalidModel.status, 400, 'invalid model profile should be rejected');
    const forbiddenField = await request('POST', '/api/detection/config', { DASHSCOPE_API_KEY: 'placeholder' });
    assert.strictEqual(forbiddenField.status, 400, 'API key field should be rejected');

    const analysis = await request('GET', '/api/analysis');
    assert.strictEqual(analysis.status, 200, 'analysis should return 200');
    assert.ok(Array.isArray(analysis.json.alerts), 'analysis should include alerts array');
    assert.ok(Array.isArray(analysis.json.detections), 'analysis should include detections array');

    const cameras = await request('GET', '/api/cameras');
    assert.strictEqual(cameras.status, 200, 'cameras should return 200');
    assert.ok(Array.isArray(cameras.json.cameras), 'cameras should include array');

    const frame = await request('GET', '/api/frame');
    assert.ok([200, 404].includes(frame.status), 'frame should return JPEG or no-frame status');
    if (frame.status === 200) {
      assert.ok(String(frame.headers['content-type']).includes('image'), 'frame should be an image');
    }

    const sse = await readSseFirstEvent('/api/events');
    assert.strictEqual(sse.status, 200, 'SSE should return 200');
    assert.ok(String(sse.headers['content-type']).includes('text/event-stream'), 'SSE content type should be text/event-stream');
    assert.ok(Array.isArray(sse.payload.alerts), 'SSE initial payload should include alerts');
    assert.ok(Array.isArray(sse.payload.detections), 'SSE initial payload should include detections');

    const monitorHtml = read('html/monitor.html');
    assert.ok(!monitorHtml.includes(p('/api/skills/', 'install')), 'monitor should not call web skill install');
    assert.ok(monitorHtml.includes('/dashboard'), 'monitor should be dashboard compatibility entry');
    const recordingsHtml = read('html/recordings.html');
    assert.ok(!recordingsHtml.includes('autoStartRec(group.cameraId)'), 'recordings page should not auto-start recordings');
    assert.throws(
      () => foundation.resolveAlertSnapshotPath('data/snapshots/../../secret.jpg'),
      /traversal/i,
      'snapshot resolver should reject traversal'
    );
  } finally {
    stopChild(server);
    if (hadExistingConfig) {
      fs.writeFileSync(existingConfigPath, existingConfig);
    } else if (fs.existsSync(existingConfigPath)) {
      fs.rmSync(existingConfigPath);
    }
  }

  console.log('Round6 e2e validation checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
