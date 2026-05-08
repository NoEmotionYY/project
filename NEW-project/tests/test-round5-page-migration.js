const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertExists(relPath) {
  assert.ok(fs.existsSync(path.join(ROOT, relPath)), `${relPath} should exist`);
}

function assertContains(content, needle, label) {
  assert.ok(content.includes(needle), `${label} should contain ${needle}`);
}

function assertNotContains(content, needle, label) {
  assert.ok(!content.includes(needle), `${label} should not contain ${needle}`);
}

function assertForbiddenAbsent(content, forbidden, label) {
  for (const item of forbidden) {
    assertNotContains(content, item, label);
  }
}

function p(...parts) {
  return parts.join('');
}

function testEventsPage() {
  assertExists('html/events.html');
  const html = read('html/events.html');
  assertForbiddenAbsent(html, [
    '/logs',
    p('/api/alerts/', 'recent'),
    p('/video', '_feed'),
    p('127.0.0.1', ':8000'),
    p('py', 'webview')
  ], 'html/events.html');
  assertContains(html, '/api/alerts', 'html/events.html');
  assertContains(html, '/snapshot', 'html/events.html');
}

function testSettingsPage() {
  assertExists('html/settings.html');
  const html = read('html/settings.html');
  assertForbiddenAbsent(html, [
    p('/camera', '_config'),
    p('/test', '_camera'),
    p('/api/model/', 'current'),
    p('/api/model/', 'switch'),
    p('py', 'webview'),
    p('127.0.0.1', ':8000')
  ], 'html/settings.html');
  assertContains(html, '/api/detection/config', 'html/settings.html');
  assertContains(html, '/api/cameras', 'html/settings.html');
  assertContains(html, '/api/skills', 'html/settings.html');
}

function testDashboardPage() {
  assertExists('html/dashboard.html');
  const html = read('html/dashboard.html');
  assertForbiddenAbsent(html, [
    p('/video', '_feed'),
    p('/api/alerts/', 'recent'),
    p('/camera', '_config'),
    p('127.0.0.1', ':8000')
  ], 'html/dashboard.html');
  assertContains(html, '/api/events', 'html/dashboard.html');
  assertContains(html, '/api/analysis', 'html/dashboard.html');
  assert.ok(
    html.includes('/api/frame') || html.includes('/api/cameras/'),
    'html/dashboard.html should use CYPHER frame APIs'
  );
}

function testMonitorAndRecordingsSafety() {
  const monitor = read('html/monitor.html');
  assertContains(monitor, '/dashboard', 'html/monitor.html');
  assertNotContains(monitor, 'skill-sidebar', 'html/monitor.html');
  assertNotContains(monitor, 'skill-file-input', 'html/monitor.html');
  assertNotContains(monitor, p('/api/skills/', 'install'), 'html/monitor.html');

  const recordings = read('html/recordings.html');
  assertNotContains(recordings, 'autoStartRec(group.cameraId)', 'html/recordings.html');
}

function testRoutes() {
  for (const relPath of ['src/server.js', 'server.js']) {
    const source = read(relPath);
    assertContains(source, "app.get('/events'", relPath);
    assertContains(source, "app.get('/settings'", relPath);
    assertContains(source, "app.get('/dashboard'", relPath);
    assertContains(source, "app.get('/monitor'", relPath);
    assertContains(source, 'dashboard.html', relPath);
  }
}

testEventsPage();
testSettingsPage();
testDashboardPage();
testMonitorAndRecordingsSafety();
testRoutes();

console.log('Round5 page migration checks passed');
