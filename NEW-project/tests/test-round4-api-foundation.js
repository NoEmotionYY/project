const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const foundation = require('../src/round4-api-foundation');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cypher-round4-'));
}

function runPython(args, options = {}) {
  const python = process.env.PYTHON_PATH || process.env.PYTHON || 'python';
  const result = spawnSync(python, args, {
    input: options.input,
    cwd: options.cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `python exited ${result.status}`);
  }
  return result.stdout;
}

function runHelper(helperPath, payload, cwd) {
  const stdout = runPython([helperPath], {
    input: JSON.stringify(payload),
    cwd
  });
  return JSON.parse(stdout);
}

function testDetectionConfigDefaultsAndSave() {
  const tmp = makeTempDir();
  const dataDir = path.join(tmp, 'data');
  const config = foundation.readDetectionConfig({ dataDir, env: {} });

  assert.strictEqual(config.thresholds.helmet, 0.35);
  assert.strictEqual(config.confirmFrames.fire, 2);
  assert.strictEqual(config.cooldowns.smoke, 10);
  assert.strictEqual(config.modelProfile, 'default');
  assert.strictEqual(config.qwenReview, false);
  assert.strictEqual(config.analysisIntervalMs, 1000);

  const saved = foundation.writeDetectionConfig({
    thresholds: { 'no-helmet': 0.72 },
    confirmFrames: { 'no-helmet': 4 },
    cooldowns: { fire: 12 },
    modelProfile: 'ppe',
    qwenReview: true,
    analysisIntervalMs: 1500
  }, { dataDir, env: {} });

  assert.strictEqual(saved.thresholds['no-helmet'], 0.72);
  assert.strictEqual(saved.confirmFrames['no-helmet'], 4);
  assert.strictEqual(saved.cooldowns.fire, 12);
  assert.strictEqual(saved.modelProfile, 'ppe');
  assert.strictEqual(saved.qwenReview, true);
  assert.strictEqual(saved.analysisIntervalMs, 1500);
  assert.ok(fs.existsSync(path.join(dataDir, 'detection-config.json')));
}

function testDetectionConfigRejectsUnsafeInput() {
  assert.throws(
    () => foundation.validateDetectionConfig({ thresholds: { 'no-helmet': 1.5 } }),
    /Invalid threshold no-helmet/
  );
  assert.throws(
    () => foundation.validateDetectionConfig({ modelProfile: 'C:/models/best.pt' }),
    /Invalid modelProfile/
  );
  assert.throws(
    () => foundation.validateDetectionConfig({ DASHSCOPE_API_KEY: 'placeholder-token' }),
    /Unsupported detection config field/
  );
}

function testSnapshotPathResolution() {
  const tmp = makeTempDir();
  const snapshotRoot = path.join(tmp, 'data', 'snapshots');
  fs.mkdirSync(path.join(snapshotRoot, '2026-05-06'), { recursive: true });
  const relativePath = 'data/snapshots/2026-05-06/cam-1_fire_003421.jpg';
  const fullPath = path.join(tmp, relativePath);
  fs.writeFileSync(fullPath, 'jpg');

  const resolved = foundation.resolveAlertSnapshotPath(relativePath, {
    projectRoot: tmp,
    snapshotRoot
  });
  assert.strictEqual(resolved, path.resolve(fullPath));
  assert.throws(
    () => foundation.resolveAlertSnapshotPath('data/snapshots/../../secret.jpg', {
      projectRoot: tmp,
      snapshotRoot
    }),
    /blocked/
  );
  assert.throws(
    () => foundation.resolveAlertSnapshotPath('data/snapshots/2026-05-06/readme.txt', {
      projectRoot: tmp,
      snapshotRoot
    }),
    /Unsupported snapshot/
  );
}

function testAlertStoreHelper() {
  const tmp = makeTempDir();
  const scriptsDir = path.join(tmp, 'scripts');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const helperCopy = path.join(scriptsDir, 'query-alerts.py');
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'query-alerts.py'), helperCopy);

  const emptyList = runHelper(helperCopy, { action: 'list', query: {} }, tmp);
  assert.deepStrictEqual(emptyList.items, []);
  assert.strictEqual(emptyList.total, 0);

  const createDbCode = `
import json, sqlite3
conn = sqlite3.connect(r"${path.join(dataDir, 'alerts.db').replace(/\\/g, '\\\\')}")
conn.execute("""CREATE TABLE alerts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL,
 created_at_ms INTEGER,
 camera_id TEXT NOT NULL,
 camera_label TEXT,
 category TEXT NOT NULL,
 category_cn TEXT NOT NULL,
 alert_type TEXT,
 title TEXT,
 severity TEXT NOT NULL,
 confidence REAL,
 model_name TEXT,
 skill_id TEXT,
 message TEXT,
 snapshot_path TEXT,
 video_path TEXT,
 source_skill TEXT,
 reviewed_by_qwen INTEGER,
 qwen_result TEXT,
 raw_json TEXT
)""")
conn.execute("""INSERT INTO alerts(
 created_at, created_at_ms, camera_id, camera_label, category, category_cn,
 alert_type, title, severity, confidence, model_name, skill_id, message,
 snapshot_path, video_path, source_skill, reviewed_by_qwen, qwen_result, raw_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
 "2026-05-06T12:00:00.000Z", 1778068800000, "cam-1", "north",
 "ppe", "未戴安全帽", "no-helmet", "未戴安全帽", "warning", 0.87,
 "best.pt", "yolo-safety", "confirmed", "data/snapshots/2026-05-06/cam-1_no-helmet_120000.jpg",
 None, "yolo-safety", 0, None, json.dumps({"alert": {"type": "no-helmet"}}, ensure_ascii=False)
))
conn.commit()
conn.close()
`;
  runPython(['-c', createDbCode], { cwd: tmp });

  const list = runHelper(helperCopy, { action: 'list', query: { category: 'no-helmet' } }, tmp);
  assert.strictEqual(list.success, true);
  assert.strictEqual(list.total, 1);
  assert.strictEqual(list.items[0].skill_id, 'yolo-safety');
  assert.strictEqual(list.items[0].raw_json, undefined);

  const detail = runHelper(helperCopy, { action: 'detail', id: 1 }, tmp);
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.item.raw.alert.type, 'no-helmet');

  const snapshot = runHelper(helperCopy, { action: 'snapshot', id: 1 }, tmp);
  assert.strictEqual(snapshot.success, true);
  assert.strictEqual(snapshot.snapshot_path, 'data/snapshots/2026-05-06/cam-1_no-helmet_120000.jpg');
}

function testEventsRouteStillSse() {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/events'/);
  assert.match(serverSource, /text\/event-stream/);
  assert.doesNotMatch(serverSource, /app\.get\('\/api\/events'[\s\S]{0,300}runAlertQuery/);
}

function run() {
  const tests = [
    testDetectionConfigDefaultsAndSave,
    testDetectionConfigRejectsUnsafeInput,
    testSnapshotPathResolution,
    testAlertStoreHelper,
    testEventsRouteStillSse
  ];
  for (const test of tests) {
    test();
    console.log(`ok - ${test.name}`);
  }
}

run();
