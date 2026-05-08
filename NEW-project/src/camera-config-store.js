const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const CAMERA_CONFIG_PATH = path.join(DATA_DIR, 'cameras.json');

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return target;
}

function safeText(input, fallback = '') {
  const value = String(input || fallback).replace(/[\r\n\t]/g, ' ').trim();
  return value.slice(0, 120);
}

function isRtspUrl(url) {
  return typeof url === 'string' && /^rtsp:\/\//i.test(url.trim());
}

function maskCameraUrl(url) {
  const value = String(url || '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      const user = parsed.username ? `${parsed.username}:***@` : '***@';
      return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}${parsed.search}`;
    }
    return value;
  } catch (_) {
    return value.replace(/(rtsp:\/\/)([^:@/\s]+):([^@/\s]+)@/i, '$1$2:***@');
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = safeText(record.id);
  const url = safeText(record.url);
  if (!id || !isRtspUrl(url)) return null;
  return {
    id,
    type: 'rtsp',
    sourceType: ['rtsp', 'ip', 'url'].includes(record.sourceType) ? record.sourceType : 'rtsp',
    label: safeText(record.label, id) || id,
    url
  };
}

function readCameraConfig(env = process.env) {
  const result = { cameras: [], active: '' };
  try {
    if (fs.existsSync(CAMERA_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CAMERA_CONFIG_PATH, 'utf-8'));
      if (Array.isArray(parsed.cameras)) {
        result.cameras = parsed.cameras.map(normalizeRecord).filter(Boolean);
      }
      if (typeof parsed.active === 'string') result.active = safeText(parsed.active);
    }
  } catch (err) {
    console.warn('[camera-config] failed to read data/cameras.json:', err.message);
  }

  const defaultUrl = safeText(env.DEFAULT_RTSP_URL || '');
  if (isRtspUrl(defaultUrl) && !result.cameras.some(camera => camera.url === defaultUrl)) {
    result.cameras.push({
      id: 'env-default-rtsp',
      type: 'rtsp',
      sourceType: 'rtsp',
      label: safeText(env.DEFAULT_RTSP_LABEL || 'Default RTSP camera'),
      url: defaultUrl
    });
  }
  return result;
}

function writeCameraConfig(cameras, active) {
  const target = resolveInside(DATA_DIR, 'cameras.json');
  const payload = {
    cameras: (Array.isArray(cameras) ? cameras : []).map(normalizeRecord).filter(Boolean),
    active: safeText(active || '')
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  return payload;
}

module.exports = {
  CAMERA_CONFIG_PATH,
  DATA_DIR,
  isRtspUrl,
  maskCameraUrl,
  readCameraConfig,
  safeText,
  writeCameraConfig
};
