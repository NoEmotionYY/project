/**
 * Node.js 核心服务
 * 职责: WebRTC 收流、RTSP 拉流、抽帧、AI 技能调用、SSE 推送、HTTPS API
 */
require('dotenv').config({ quiet: true });

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PROJECT_ROOT = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : path.resolve(__dirname, '..');

function requireProjectModule(name) {
  const localPath = path.join(__dirname, `${name}.js`);
  return fs.existsSync(localPath) ? require(`./${name}`) : require(`./src/${name}`);
}

// ========== 启动诊断日志 ==========
const LOG_DIR = process.env.LOG_DIR || path.join(PROJECT_ROOT, 'logs');
const SERVER_LOG = path.join(LOG_DIR, 'server.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
function slog(msg) {
  try {
    fs.appendFileSync(SERVER_LOG, `[${new Date().toISOString()}] [SERVER] ${msg}\n`);
  } catch (_) {}
}
slog('========== server.js starting ==========');
slog(`__dirname: ${__dirname}`);
slog(`NODE_PATH: ${process.env.NODE_PATH || '(not set)'}`);
slog(`PORT env: ${process.env.PORT || '(not set)'}`);
slog(`NODE_PORT env: ${process.env.NODE_PORT || '(not set)'}`);
slog(`CERT_PATH: ${process.env.CERT_PATH || '(not set)'}`);
slog(`KEY_PATH: ${process.env.KEY_PATH || '(not set)'}`);

process.on('uncaughtException', (err) => {
  slog(`FATAL uncaughtException: ${err.message}\n${err.stack}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  slog(`FATAL unhandledRejection: ${reason}`);
  process.exit(1);
});
// ========== 启动诊断日志结束 ==========

const sharp = require('sharp');
const { RTCPeerConnection, RTCSessionDescription } = require('@roamhq/wrtc');
const { RTCVideoSink, RTCAudioSink, i420ToRgba } = require('@roamhq/wrtc').nonstandard;
const { findAvailablePort } = requireProjectModule('port-utils');
const {
  readCameraConfig,
  writeCameraConfig,
  maskCameraUrl,
  safeText
} = requireProjectModule('camera-config-store');

// ffmpeg path
let FFMPEG_PATH;
if (process.env.FFMPEG_PATH) {
  FFMPEG_PATH = process.env.FFMPEG_PATH;
  console.log('[ffmpeg] 使用 .env FFMPEG_PATH:', FFMPEG_PATH);
} else try {
  FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
  console.log('[ffmpeg] 使用 npm 捆绑路径:', FFMPEG_PATH);
} catch (e) {
  FFMPEG_PATH = 'ffmpeg'; // 回退到系统 PATH
  console.log('[ffmpeg] 使用系统 PATH 中的 ffmpeg');
}

// ==========================================
// 配置
// ==========================================
let PORT = parseInt(process.env.PORT || process.env.NODE_PORT, 10) || 8082;
const ANALYSIS_INTERVAL = 1; // analysis interval seconds
const LOG_FILE = path.join(process.env.LOG_DIR || __dirname, 'ai_analysis_log.txt');
const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 每个摄像头的 JSON 分析日志
const RUNTIME_FRAME_DIR = resolveInside(PROJECT_ROOT, 'data', 'runtime-frames'); // 传给 Python 技能的当前帧文件
const ANALYZE_TIMEOUT_MS = Number(process.env.CYPHER_ANALYZE_TIMEOUT_MS || 30000);

function safeName(input, fallback = 'default') {
  const safeFallback = String(fallback || 'default').replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
  const value = String(input || safeFallback);
  const base = path.basename(value);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!cleaned || cleaned === '.' || cleaned === '..') return safeFallback;
  return cleaned;
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return target;
}

const round4Foundation = require(
  fs.existsSync(path.join(__dirname, 'round4-api-foundation.js'))
    ? './round4-api-foundation'
    : './src/round4-api-foundation'
);
const {
  readDetectionConfig,
  writeDetectionConfig,
  buildSkillConfigContext,
  parsePositiveInt,
  resolveAlertSnapshotPath,
  ALERT_HELPER_PATH
} = round4Foundation;
const PYTHON_BIN = process.env.PYTHON_PATH || process.env.PYTHON || 'python';

// ==========================================
// 加载 AI 技能（通过技能管理器）
// ==========================================
const skillManager = requireProjectModule('skill-manager');
let aiSkill; // 向后兼容，保留引用

// 不再默认启用任何技能。
// 技能是否参与分析完全由 skills-state.json 和 /api/skills/toggle 控制。
try {
  const status = skillManager.getSkillsStatus();
  const enabledCount = status.filter(p => p.enabled).length;
  const failedSkills = skillManager.getFailedSkills();
  
  console.log(`[技能] 当前启用 ${enabledCount} / ${status.length} 个技能`);
  
  if (failedSkills.length > 0) {
    console.error('[技能] ⚠️ 以下技能加载失败:');
    failedSkills.forEach(skill => {
      console.error(`  - ${skill.label} (${skill.id}): ${skill.reason}`);
    });
  }
  
  // 验证启用的技能是否正常加载
  const enabledSkills = status.filter(p => p.enabled);
  const loadedEnabledSkills = enabledSkills.filter(p => p.loaded);
  
  if (enabledSkills.length > 0 && loadedEnabledSkills.length === 0) {
    console.error('[技能] ⚠️ 警告: 所有启用的技能都未能成功加载！');
    console.error('[技能] 请检查:');
    console.error('  1. Python 依赖是否正确安装 (pip install -r requirements.txt)');
    console.error('  2. YOLO 模型文件是否存在于 skills/ 目录');
    console.error('  3. 查看上面的错误日志了解详细原因');
  } else if (loadedEnabledSkills.length < enabledSkills.length) {
    const notLoaded = enabledSkills.filter(p => !p.loaded);
    console.warn(`[技能] ⚠️ ${notLoaded.length} 个技能未能加载:`);
    notLoaded.forEach(skill => {
      console.warn(`  - ${skill.label} (${skill.id})`);
    });
  }
  
  aiSkill = skillManager;
} catch (e) {
  console.error('[技能] 初始化失败:', e.message);
  console.error('[技能] 堆栈跟踪:', e.stack);
  aiSkill = null;
}

// ==========================================
// 企业微信推送集成
// ==========================================
let wechatPushProcess = null;
let wechatPushReady = false;

function startWechatPush() {
  try {
    const wechatPushPath = path.join(PROJECT_ROOT, 'skills', 'wechat-push.py');
    if (!fs.existsSync(wechatPushPath)) {
      console.log('[WeChat Push] wechat-push.py 不存在，跳过启动');
      return;
    }

    wechatPushProcess = spawn(PYTHON_BIN, [wechatPushPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });

    let readBuffer = '';
    wechatPushProcess.stdout.on('data', (data) => {
      readBuffer += data.toString();
      const lines = readBuffer.split('\n');
      readBuffer = lines.pop();
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.status === 'ready') {
            wechatPushReady = true;
            console.log('[WeChat Push] 已就绪');
            // 发送开机通知
            sendWechatStartupNotification();
          } else if (response.result) {
            console.log('[WeChat Push]', response.result.text || '');
          }
        } catch (e) {
          console.error('[WeChat Push] 解析响应失败:', e.message);
        }
      }
    });

    wechatPushProcess.stderr.on('data', (data) => {
      console.error('[WeChat Push Error]', data.toString().trim());
    });

    wechatPushProcess.on('error', (err) => {
      console.error('[WeChat Push] 启动失败:', err.message);
    });

    wechatPushProcess.on('close', (code) => {
      console.log(`[WeChat Push] 退出 (code ${code})`);
      wechatPushReady = false;
      wechatPushProcess = null;
    });

    console.log('[WeChat Push] 正在启动...');
  } catch (e) {
    console.error('[WeChat Push] 启动异常:', e.message);
  }
}

function sendWechatMessage(payload) {
  if (!wechatPushProcess || !wechatPushReady) {
    console.warn('[WeChat Push] 未就绪，跳过推送');
    return;
  }

  try {
    // 确保使用 UTF-8 编码发送中文消息，避免乱码
    const message = JSON.stringify(payload, null, null);
    wechatPushProcess.stdin.write(message + '\n', 'utf-8');
  } catch (e) {
    console.error('[WeChat Push] 发送消息失败:', e.message);
  }
}

function sendWechatStartupNotification() {
  sendWechatMessage({ action: 'startup' });
}

function sendWechatAlert(alertData) {
  // 统一使用精确时间格式：YYYY-MM-DD HH:MM:SS
  const now = new Date();
  const preciseTime = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + ' ' + 
    String(now.getHours()).padStart(2, '0') + ':' + 
    String(now.getMinutes()).padStart(2, '0') + ':' + 
    String(now.getSeconds()).padStart(2, '0');
  
  const payload = {
    action: 'send_alert',
    title: alertData.title || '系统安全告警',
    description: alertData.description || alertData.text || '检测到异常',
    camera: alertData.camera || alertData.cameraId || '未知监控点',
    time: preciseTime  // 始终使用当前精确时间，忽略传入的 time 参数
  };
  sendWechatMessage(payload);
}
// ==========================================
// ==========================================
// 全局状态// ==========================================
let isAnalyzing = false;
let activeCameraId = 'webrtc';  // current active camera
let cameraIdCounter = 0;

let aiResult = {
  cameraId: activeCameraId,
  text: '等待分析...',
  time: '',
  analyzing: false,
  alert: false,
  alert_message: '',
  alert_details: [],
  voice_reminder: false,
  voice_text: '',
  voice_texts: [],
  risk_level: 'none',
  cleanup_hint: '',
  evacuate_reminder: false,
  evacuate_text: '',
  beep_count: 0,
  alerts: [],
  detections: []
};

const sseClients = new Map();
const peerConnections = new Set();

// ==========================================
// 多摄像头管理
// ==========================================
// cameras: Map<id, { id, type:'rtsp'|'webrtc', url, status, error, frameCount, latestJpeg, rtspProcess }>
const cameras = new Map();

function envInt(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const RTSP_WIDTH = envInt('RTSP_WIDTH', 1280, 320, 3840);
const RTSP_HEIGHT = envInt('RTSP_HEIGHT', 720, 180, 2160);
const RTSP_FPS = envInt('RTSP_FPS', 25, 1, 60);
const RTSP_JPEG_QUALITY = envInt('RTSP_JPEG_QUALITY', 80, 40, 95);
const RTSP_MAX_BUFFER_FRAMES = envInt('RTSP_MAX_BUFFER_FRAMES', 3, 1, 30);
const RTSP_MJPEG_MAX_BUFFER_BYTES = envInt('RTSP_MJPEG_MAX_BUFFER_MB', 8, 1, 128) * 1024 * 1024;
const MJPEG_DEFAULT_FPS = envInt('MJPEG_DEFAULT_FPS', 25, 1, 60);

function ffmpegMjpegQscaleFromQuality(quality) {
  return Math.max(2, Math.min(12, Math.round(2 + ((95 - quality) / 55) * 10)));
}

function sanitizeCameraLabel(input, fallback) {
  return safeText(input, fallback).replace(/[<>]/g, '').slice(0, 80) || fallback;
}

function normalizeRtspUrl(url) {
  const value = safeText(url);
  if (!/^rtsp:\/\//i.test(value)) {
    throw new Error('需要有效的 RTSP 地址');
  }
  return value;
}

function normalizeSourceType(input) {
  return ['rtsp', 'ip', 'url'].includes(input) ? input : 'rtsp';
}

function createCamera(id, type, value, options = {}) {
  const camera = {
    id,
    type,
    url: '',
    label: '',
    sourceType: type === 'rtsp' ? 'rtsp' : 'webrtc',
    status: 'disconnected',
    error: '',
    frameCount: 0,
    latestJpeg: null,
    latestDetections: [],
    latestDetectionAt: 0,
    latestAnnotatedJpeg: null,
    latestAnnotatedKey: '',
    latestAudio: null,
    audioStatus: 'idle',
    audioError: '',
    audioFrameCount: 0,
    audioWindow: null,
    rtspProcess: null
  };
  if (type === 'rtsp') {
    camera.url = value || '';
    camera.label = sanitizeCameraLabel(options.label, id);
    camera.sourceType = normalizeSourceType(options.sourceType);
  } else {
    camera.label = sanitizeCameraLabel(value, id);
  }
  return camera;
}

function getCamera(id) {
  return cameras.get(id);
}

function getActiveCamera() {
  return cameras.get(activeCameraId);
}

function getLatestFrameJpeg() {
  const cam = getActiveCamera();
  return cam ? cam.latestJpeg : null;
}

function escapeSvgText(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeDetectionBox(det, width, height) {
  if (!det || !width || !height) return null;

  const source = det.box || det.bbox || det.xyxy || det.rect;
  if (!source) return null;

  let x1;
  let y1;
  let x2;
  let y2;

  if (Array.isArray(source)) {
    if (source.length < 4) return null;
    x1 = Number(source[0]);
    y1 = Number(source[1]);

    const third = Number(source[2]);
    const fourth = Number(source[3]);
    const format = String(det.boxFormat || det.bboxFormat || '').toLowerCase();

    if (format.includes('xywh')) {
      x2 = x1 + third;
      y2 = y1 + fourth;
    } else {
      x2 = third;
      y2 = fourth;
    }
  } else {
    x1 = Number(source.x1 ?? source.left ?? source.x ?? 0);
    y1 = Number(source.y1 ?? source.top ?? source.y ?? 0);

    if (source.x2 !== undefined || source.right !== undefined) {
      x2 = Number(source.x2 ?? source.right);
    } else {
      x2 = x1 + Number(source.w ?? source.width ?? 0);
    }

    if (source.y2 !== undefined || source.bottom !== undefined) {
      y2 = Number(source.y2 ?? source.bottom);
    } else {
      y2 = y1 + Number(source.h ?? source.height ?? 0);
    }
  }

  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

  // 兼容 0~1 归一化坐标
  if (x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1) {
    x1 *= width;
    x2 *= width;
    y1 *= height;
    y2 *= height;
  }

  const left = clampNumber(Math.min(x1, x2), 0, width - 1);
  const top = clampNumber(Math.min(y1, y2), 0, height - 1);
  const right = clampNumber(Math.max(x1, x2), 0, width);
  const bottom = clampNumber(Math.max(y1, y2), 0, height);

  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);

  return {
    x: Math.round(left),
    y: Math.round(top),
    w: Math.round(w),
    h: Math.round(h)
  };
}

async function drawDetectionsOnJpeg(jpegBuffer, detections = []) {
  if (!jpegBuffer || !Array.isArray(detections) || detections.length === 0) {
    return jpegBuffer;
  }

  const metadata = await sharp(jpegBuffer).metadata();
  const width = metadata.width || 1280;
  const height = metadata.height || 720;

  const items = detections
    .map(det => ({ det, box: normalizeDetectionBox(det, width, height) }))
    .filter(item => item.box);

  if (!items.length) return jpegBuffer;

  const svgParts = items.map(({ det, box }) => {
    const rawLabel = det.name || det.label || det.className || det.class || det.type || 'object';
    const label = escapeSvgText(rawLabel);
    const confidence = Number(det.confidence ?? det.conf ?? det.score);
    const confText = Number.isFinite(confidence) ? ` ${(confidence * 100).toFixed(0)}%` : '';
    const text = `${label}${confText}`;

    const textW = Math.min(width - box.x, Math.max(90, text.length * 10 + 14));
    const textY = Math.max(0, box.y - 26);

    return `
      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
            fill="none" stroke="#ef4444" stroke-width="3"/>
      <rect x="${box.x}" y="${textY}" width="${textW}" height="24"
            fill="#ef4444" fill-opacity="0.88"/>
      <text x="${box.x + 6}" y="${textY + 17}"
            font-size="15" font-family="Arial, Microsoft YaHei, sans-serif"
            fill="#ffffff">${escapeSvgText(text)}</text>
    `;
  }).join('');

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${svgParts}
    </svg>
  `;

  return sharp(jpegBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function getCameraForStream(cameraId) {
  if (!cameraId || cameraId === 'active') return getActiveCamera();
  return getCamera(cameraId);
}

async function getDisplayJpeg(camera, withBoxes = true) {
  if (!camera || !camera.latestJpeg) return null;

  const detections = Array.isArray(camera.latestDetections) ? camera.latestDetections : [];
  const detectionFresh = Date.now() - Number(camera.latestDetectionAt || 0) <= 12000;

  if (!withBoxes || !detectionFresh || detections.length === 0) {
    return camera.latestJpeg;
  }

  const cacheKey = `${camera.frameCount || 0}:${camera.latestDetectionAt || 0}`;
  if (camera.latestAnnotatedJpeg && camera.latestAnnotatedKey === cacheKey) {
    return camera.latestAnnotatedJpeg;
  }

  const annotated = await drawDetectionsOnJpeg(camera.latestJpeg, detections);
  camera.latestAnnotatedJpeg = annotated;
  camera.latestAnnotatedKey = cacheKey;
  return annotated;
}

function sendMjpegStream(req, res, cameraId = 'active') {
  const requestedCamera = getCameraForStream(cameraId);
  if (cameraId !== 'active' && !requestedCamera) {
    res.status(404).send('Camera not found');
    return;
  }

  const fpsRaw = Number(req.query.fps || MJPEG_DEFAULT_FPS);
  const fps = Number.isFinite(fpsRaw) ? Math.max(1, Math.min(60, Math.floor(fpsRaw))) : MJPEG_DEFAULT_FPS;
  const intervalMs = Math.floor(1000 / fps);
  const withBoxes = req.query.boxes !== '0';

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let closed = false;
  let sending = false;
  let lastSentKey = '';
  let timer = null;

  req.on('close', () => {
    closed = true;
    if (timer) clearInterval(timer);
  });

  timer = setInterval(async () => {
    if (closed) {
      clearInterval(timer);
      return;
    }

    if (sending) return;
    sending = true;

    try {
      const camera = getCameraForStream(cameraId);
      const frameKey = camera ? `${camera.id}:${camera.frameCount || 0}:${withBoxes ? camera.latestDetectionAt || 0 : 0}` : '';
      if (!frameKey || frameKey === lastSentKey) {
        sending = false;
        return;
      }

      const jpeg = await getDisplayJpeg(camera, withBoxes);

      if (!jpeg) {
        sending = false;
        return;
      }

      if (res.writableLength > 2 * 1024 * 1024) {
        sending = false;
        return;
      }

      const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      const footer = Buffer.from('\r\n');
      const ok = res.write(Buffer.concat([header, jpeg, footer]));
      lastSentKey = frameKey;
      if (!ok) {
        await new Promise(resolve => {
          res.once('drain', resolve);
          res.once('close', resolve);
        });
      }
    } catch (err) {
      console.warn('[mjpeg] 输出帧失败:', err.message);
    } finally {
      sending = false;
    }
  }, intervalMs);
}


function getLatestAudioMetrics(cameraId = activeCameraId) {
  const cam = getCamera(cameraId);
  if (!cam || !cam.latestAudio) return null;
  const ageMs = Date.now() - cam.latestAudio.lastAt;
  return {
    ...cam.latestAudio,
    ageMs,
    fresh: ageMs <= 3000,
    status: ageMs <= 3000 ? (cam.audioStatus || 'receiving') : 'stale'
  };
}

function dbfsFromRatio(value) {
  if (!Number.isFinite(value) || value <= 0) return -120;
  return Math.max(-120, Math.min(0, 20 * Math.log10(value)));
}

const audioAlertStates = new Map();
let cachedAudioConfig = null;
let cachedAudioConfigAt = 0;

function getRuntimeAudioConfig() {
  const now = Date.now();
  if (!cachedAudioConfig || now - cachedAudioConfigAt > 500) {
    cachedAudioConfig = getDetectionConfig().audio || {};
    cachedAudioConfigAt = now;
  }
  return cachedAudioConfig;
}

function getAudioAlertState(cameraId) {
  const key = String(cameraId || 'active');
  if (!audioAlertStates.has(key)) {
    audioAlertStates.set(key, {
      loudCount: 0,
      lastAlertAt: 0
    });
  }
  return audioAlertStates.get(key);
}

function getAudioAlertLevel(audioMetrics) {
  const candidates = [
    audioMetrics && audioMetrics.windowPeakDbfs,
    audioMetrics && audioMetrics.peakDbfs,
    audioMetrics && audioMetrics.dbfs
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return -120;
}

function maybeBroadcastAudioAlert(camId, cam, audioMetrics) {
  const config = getRuntimeAudioConfig();
  if (config.enabled === false) return;

  const threshold = Number.isFinite(Number(config.loudDbfs)) ? Number(config.loudDbfs) : -18;
  const confirmFrames = Math.max(1, Math.min(20, Math.floor(Number(config.confirmFrames) || 3)));
  const cooldownMs = Math.max(0, Number(config.cooldownSeconds) || 8) * 1000;
  const levelDbfs = getAudioAlertLevel(audioMetrics);
  const state = getAudioAlertState(camId);

  if (levelDbfs < threshold) {
    state.loudCount = 0;
    return;
  }

  state.loudCount += 1;
  const now = Date.now();
  if (state.loudCount < confirmFrames || now - state.lastAlertAt < cooldownMs) return;

  state.lastAlertAt = now;
  state.loudCount = 0;

  const timestamp = new Date(now).toISOString();
  const alertEvent = {
    type: 'loud-audio',
    title: '异常响声警告',
    timestamp,
    db_level: levelDbfs,
    category: 'audio',
    severity: 'warning',
    description: `检测到异常响声：${levelDbfs.toFixed(1)} dBFS，阈值 ${threshold} dBFS`,
    cameraId: camId,
    cameraLabel: cam ? (cam.label || cam.id || camId) : camId,
    device_name: config.inputDeviceLabel || ''
  };

  if (typeof global.broadcastAudioEvent === 'function') {
    global.broadcastAudioEvent(alertEvent);
  } else {
    broadcastSSE({
      text: alertEvent.description,
      alert: true,
      risk_level: 'medium',
      alerts: [alertEvent],
      detections: []
    });
  }
}

function normalizeAudioSamples(samples) {
  if (!samples) return null;
  if (samples instanceof Int16Array) return samples;
  if (ArrayBuffer.isView(samples)) {
    return new Int16Array(samples.buffer, samples.byteOffset, Math.floor(samples.byteLength / 2));
  }
  if (samples instanceof ArrayBuffer) return new Int16Array(samples);
  return null;
}

function updateAudioMetrics(camId, audioData) {
  const samples = normalizeAudioSamples(audioData.samples);
  if (!samples || samples.length === 0) return false;

  let cam = getCamera(camId);
  if (!cam) {
    cam = createCamera(camId, 'webrtc', `手机推流 (${camId})`);
    cameras.set(camId, cam);
  }

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-32768, Math.min(32767, Number(samples[i]) || 0));
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
  }

  const rms = Math.sqrt(sumSquares / samples.length) / 32768;
  const peakRatio = peak / 32768;
  const dbfs = dbfsFromRatio(rms);
  const peakDbfs = dbfsFromRatio(peakRatio);
  const now = Date.now();
  const windowMs = 1000;

  if (!cam.audioWindow || now - cam.audioWindow.startAt > windowMs) {
    cam.audioWindow = {
      startAt: now,
      count: 0,
      dbfsSum: 0,
      peakDbfs
    };
  }

  cam.audioWindow.count += 1;
  cam.audioWindow.dbfsSum += dbfs;
  cam.audioWindow.peakDbfs = Math.max(cam.audioWindow.peakDbfs, peakDbfs);

  const windowAvgDbfs = cam.audioWindow.dbfsSum / cam.audioWindow.count;
  cam.audioStatus = 'receiving';
  cam.audioError = '';
  cam.audioFrameCount = (cam.audioFrameCount || 0) + 1;
  cam.latestAudio = {
    status: 'receiving',
    lastAt: now,
    sampleRate: audioData.sampleRate || 0,
    channelCount: audioData.channelCount || 0,
    bitsPerSample: audioData.bitsPerSample || 16,
    numberOfFrames: audioData.numberOfFrames || samples.length,
    rms: Number(rms.toFixed(6)),
    peak: Number(peakRatio.toFixed(6)),
    dbfs: Number(dbfs.toFixed(2)),
    peakDbfs: Number(peakDbfs.toFixed(2)),
    windowMs,
    windowAvgDbfs: Number(windowAvgDbfs.toFixed(2)),
    windowPeakDbfs: Number(cam.audioWindow.peakDbfs.toFixed(2)),
    level: Number(Math.max(0, Math.min(1, (dbfs + 60) / 60)).toFixed(4))
  };
  maybeBroadcastAudioAlert(camId, cam, cam.latestAudio);
  return true;
}

function getAllCameraList() {
  return Array.from(cameras.values()).map(c => ({
    id: c.id,
    type: c.type,
    url: maskCameraUrl(c.url),
    hasCredentials: c.url !== maskCameraUrl(c.url),
    sourceType: c.sourceType,
    label: c.label,
    status: c.status,
    error: c.error,
    frameCount: c.frameCount,
    hasFrame: !!c.latestJpeg,
    hasAudio: !!(c.latestAudio && Date.now() - c.latestAudio.lastAt <= 3000),
    audioStatus: c.audioStatus || 'idle',
    audioDbfs: c.latestAudio ? c.latestAudio.dbfs : null,
    audioPeakDbfs: c.latestAudio ? c.latestAudio.windowPeakDbfs : null,
    audioLevel: c.latestAudio ? c.latestAudio.level : null,
    audioFrameCount: c.audioFrameCount || 0
  }));
}

function persistCameraConfig() {
  try {
    const configured = Array.from(cameras.values())
      .filter(camera => camera.type === 'rtsp' && camera.id !== 'webrtc')
      .map(camera => ({
        id: camera.id,
        type: 'rtsp',
        sourceType: camera.sourceType || 'rtsp',
        label: camera.label || camera.id,
        url: camera.url
      }));
    writeCameraConfig(configured, activeCameraId);
  } catch (err) {
    console.warn('[camera-config] 保存失败:', err.message);
  }
}

function loadConfiguredCameras() {
  const config = readCameraConfig(process.env);
  for (const record of config.cameras) {
    const cam = createCamera(record.id, 'rtsp', record.url, {
      label: record.label,
      sourceType: record.sourceType
    });
    cameras.set(record.id, cam);
    const match = /^cam-(\d+)$/.exec(record.id);
    if (match) cameraIdCounter = Math.max(cameraIdCounter, Number(match[1]));
  }
  if (config.active && cameras.has(config.active)) {
    activeCameraId = config.active;
  }
}

function publicCamera(camera) {
  return {
    id: camera.id,
    type: camera.type,
    url: maskCameraUrl(camera.url),
    hasCredentials: camera.url !== maskCameraUrl(camera.url),
    sourceType: camera.sourceType,
    label: camera.label,
    status: camera.status,
    error: camera.error,
    frameCount: camera.frameCount,
    hasFrame: !!camera.latestJpeg,
    hasAudio: !!(camera.latestAudio && Date.now() - camera.latestAudio.lastAt <= 3000),
    audioStatus: camera.audioStatus || 'idle',
    audioDbfs: camera.latestAudio ? camera.latestAudio.dbfs : null,
    audioPeakDbfs: camera.latestAudio ? camera.latestAudio.windowPeakDbfs : null,
    audioLevel: camera.latestAudio ? camera.latestAudio.level : null,
    audioFrameCount: camera.audioFrameCount || 0,
    frameEndpoint: '/api/cameras/' + encodeURIComponent(camera.id) + '/frame'
  };
}

// Initialize default WebRTC camera.
cameras.set('webrtc', createCamera('webrtc', 'webrtc', '手机推流'));
loadConfiguredCameras();

// 旧版兼容
let rtspStatus = 'disconnected';
let rtspError = '';
let rtspFrameCount = 0;
let rtspUrl = '';
let rtspProcess = null;

function stopRtspCamera(id) {
  stopVideoRecording(id);
  const cam = getCamera(id);
  if (!cam) return;
  if (cam.rtspProcess) {
    try {
      cam.rtspProcess.kill('SIGTERM');
      setTimeout(() => {
        try { if (cam.rtspProcess) cam.rtspProcess.kill('SIGKILL'); } catch (_) {}
      }, 2000);
    } catch (_) {}
    cam.rtspProcess = null;
  }
  cam.status = 'disconnected';
  cam.error = '';
  cam.frameCount = 0;
  console.log(`[RTSP:${id}] 已断开`);
  notifyRtspStatus();
}

function startRtspCamera(id, url) {
  const cam = getCamera(id);
  if (!cam) return;

  if (cam.rtspProcess) {
    stopRtspCamera(id);
  }

  cam.url = url;
  cam.status = 'connecting';
  cam.error = '';
  cam.frameCount = 0;

  console.log(`[RTSP:${id}] 正在连接: ${maskCameraUrl(url)}`);
  notifyRtspStatus();

  const rtspTransport = String(process.env.RTSP_TRANSPORT || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
  const mjpegQscale = ffmpegMjpegQscaleFromQuality(RTSP_JPEG_QUALITY);
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-rtsp_transport', rtspTransport,
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-max_delay', '100000',
    '-analyzeduration', '0',
    '-probesize', '32768',
    '-reorder_queue_size', '0',
    '-i', url,
    '-map', '0:v:0',
    '-vf', `scale=${RTSP_WIDTH}:${RTSP_HEIGHT}:flags=fast_bilinear,fps=${RTSP_FPS}`,
    '-c:v', 'mjpeg',
    '-q:v', String(mjpegQscale),
    '-f', 'image2pipe',
    '-an',
    'pipe:1'
  ];

  cam.rtspProcess = spawn(FFMPEG_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const frameSize = RTSP_WIDTH * RTSP_HEIGHT * 4;
  let buffer = Buffer.alloc(0);
  let stderrBuffer = '';
  let converting = false;
  let nextFrameData = null;
  let droppedFrames = 0;
  let convertedFrames = 0;
  let lastStatsAt = Date.now();

  function logRtspStats() {
    const now = Date.now();
    if (now - lastStatsAt < 5000) return;
    const fps = Math.round((convertedFrames * 1000) / Math.max(1, now - lastStatsAt));
    if (fps > 0 || droppedFrames > 0) {
      console.log(`[RTSP:${id}] preview fps=${fps}, dropped=${droppedFrames}`);
    }
    convertedFrames = 0;
    droppedFrames = 0;
    lastStatsAt = now;
  }

  function processLatestRtspFrame() {
    const frameData = nextFrameData;
    nextFrameData = null;

    if (!frameData) {
      converting = false;
      return;
    }

    cam.frameCount++;
    if (cam.status !== 'connected') {
      cam.status = 'connected';
      console.log(`[RTSP:${id}] connected, receiving frames ${RTSP_WIDTH}x${RTSP_HEIGHT}@${RTSP_FPS}fps`);
      notifyRtspStatus();
    }

    sharp(frameData, { raw: { width: RTSP_WIDTH, height: RTSP_HEIGHT, channels: 4 } })
      .jpeg({ quality: RTSP_JPEG_QUALITY })
      .toBuffer()
      .then((jpeg) => {
        cam.latestJpeg = jpeg;
        writeVideoFrame(id, jpeg);
        convertedFrames++;
        if (cam.frameCount === 1) {
          console.log(`[RTSP:${id}] first frame: ${RTSP_WIDTH}x${RTSP_HEIGHT}, JPEG ${jpeg.length} bytes`);
        }
        logRtspStats();
      })
      .catch((err) => {
        if (cam.frameCount <= 3) {
          console.error(`[RTSP:${id}] frame conversion error`, err.message);
        }
      })
      .finally(() => {
        if (nextFrameData) {
          setImmediate(processLatestRtspFrame);
        } else {
          converting = false;
        }
      });
  }

  function enqueueRtspFrame(frameData) {
    nextFrameData = Buffer.from(frameData);
    if (converting) {
      droppedFrames++;
      return;
    }
    converting = true;
    setImmediate(processLatestRtspFrame);
  }

  cam.rtspProcess.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const completeFrames = Math.floor(buffer.length / frameSize);
    if (completeFrames > RTSP_MAX_BUFFER_FRAMES) {
      const framesToDrop = completeFrames - RTSP_MAX_BUFFER_FRAMES;
      buffer = buffer.slice(framesToDrop * frameSize);
      droppedFrames += framesToDrop;
    }

    while (buffer.length >= frameSize) {
      const frameData = buffer.slice(0, frameSize);
      buffer = buffer.slice(frameSize);
      if (buffer.length >= frameSize) { continue; }
      enqueueRtspFrame(frameData);
      continue;

      cam.frameCount++;
      if (cam.status !== 'connected') {
        cam.status = 'connected';
        console.log(`[RTSP:${id}] connected, receiving frames`);
        notifyRtspStatus();
      }

      sharp(frameData, { raw: { width: RTSP_WIDTH, height: RTSP_HEIGHT, channels: 4 } })
        .jpeg({ quality: 85 })
        .toBuffer()
        .then((jpeg) => {
          cam.latestJpeg = jpeg;
          writeVideoFrame(id, jpeg);
          if (cam.frameCount === 1) {
            console.log(`[RTSP:${id}] first frame: ${RTSP_WIDTH}x${RTSP_HEIGHT}, JPEG ${jpeg.length} bytes`);
          } else if (cam.frameCount % 100 === 0) {
            console.log(`[RTSP:${id}] processed ${cam.frameCount} frames`);
          }
        })
        .catch((err) => {
          if (cam.frameCount <= 3) {
            console.error(`[RTSP:${id}] 帧转换错误`, err.message);
          }
        });
    }
  });

  cam.rtspProcess.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 500) stderrBuffer = stderrBuffer.slice(-500);
  });

  cam.rtspProcess.on('error', (err) => {
    console.error(`[RTSP:${id}] ffmpeg 错误:`, err.message);
    cam.status = 'error';
    cam.error = `ffmpeg 启动失败: ${err.message}`;
    cam.rtspProcess = null;
    notifyRtspStatus();
  });

  cam.rtspProcess.on('exit', (code, signal) => {
    console.log(`[RTSP:${id}] 退出code=${code} signal=${signal}`);
    if (cam.status === 'connecting' || cam.status === 'connected') {
      cam.status = 'error';
      cam.error = code !== 0
        ? `ffmpeg 异常退出code=${code}): ${stderrBuffer.trim().split('\n').pop() || '未知错误'}`
        : '连接已断开';
    }
    cam.rtspProcess = null;
    notifyRtspStatus();
  });

  setTimeout(() => {
    if (cam.status === 'connecting') {
      console.error(`[RTSP:${id}] 连接超时（30秒无帧）`);
      cam.status = 'error';
      cam.error = '连接超时，请检查 RTSP 地址是否正确';
      stopRtspCamera(id);
      notifyRtspStatus();
    }
  }, 10000);
}

// ==========================================
// 工具函数
// ==========================================
startRtspCamera = function startRtspCameraOptimized(id, url) {
  const cam = getCamera(id);
  if (!cam) return;

  if (cam.rtspProcess) {
    stopRtspCamera(id);
  }

  cam.url = url;
  cam.status = 'connecting';
  cam.error = '';
  cam.frameCount = 0;
  cam.latestJpeg = null;

  const rtspTransport = String(process.env.RTSP_TRANSPORT || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
  const mjpegQscale = ffmpegMjpegQscaleFromQuality(RTSP_JPEG_QUALITY);
  console.log(`[RTSP:${id}] 正在连接(MJPEG直出): ${maskCameraUrl(url)} transport=${rtspTransport} ${RTSP_WIDTH}x${RTSP_HEIGHT}@${RTSP_FPS}`);
  notifyRtspStatus();

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-rtsp_transport', rtspTransport,
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-max_delay', '100000',
    '-analyzeduration', '0',
    '-probesize', '32768',
    '-reorder_queue_size', '0',
    '-i', url,
    '-map', '0:v:0',
    '-vf', `scale=${RTSP_WIDTH}:${RTSP_HEIGHT}:flags=fast_bilinear,fps=${RTSP_FPS}`,
    '-c:v', 'mjpeg',
    '-q:v', String(mjpegQscale),
    '-f', 'image2pipe',
    '-an',
    'pipe:1'
  ];

  const rtspProcess = spawn(FFMPEG_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  cam.rtspProcess = rtspProcess;

  let buffer = Buffer.alloc(0);
  let stderrBuffer = '';
  let droppedFrames = 0;
  let receivedFrames = 0;
  let lastStatsAt = Date.now();
  const jpegStartMarker = Buffer.from([0xff, 0xd8]);
  const jpegEndMarker = Buffer.from([0xff, 0xd9]);

  function logRtspStats() {
    const now = Date.now();
    if (now - lastStatsAt < 5000) return;
    const fps = Math.round((receivedFrames * 1000) / Math.max(1, now - lastStatsAt));
    if (fps > 0 || droppedFrames > 0) {
      console.log(`[RTSP:${id}] preview fps=${fps}, dropped=${droppedFrames}, transport=${rtspTransport}`);
    }
    receivedFrames = 0;
    droppedFrames = 0;
    lastStatsAt = now;
  }

  function acceptJpegFrame(jpeg) {
    cam.frameCount++;
    if (cam.status !== 'connected') {
      cam.status = 'connected';
      console.log(`[RTSP:${id}] connected, receiving MJPEG frames`);
      notifyRtspStatus();
    }

    cam.latestJpeg = jpeg;
    writeVideoFrame(id, jpeg);
    receivedFrames++;

    if (cam.frameCount === 1) {
      console.log(`[RTSP:${id}] first MJPEG frame: ${jpeg.length} bytes`);
    }
    logRtspStats();
  }

  rtspProcess.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (buffer.length > RTSP_MJPEG_MAX_BUFFER_BYTES) {
      const lastStart = buffer.lastIndexOf(jpegStartMarker);
      buffer = lastStart >= 0 ? buffer.slice(lastStart) : Buffer.alloc(0);
      droppedFrames++;
    }

    while (buffer.length > 4) {
      const start = buffer.indexOf(jpegStartMarker);
      if (start < 0) {
        buffer = buffer.slice(-1);
        return;
      }
      if (start > 0) {
        buffer = buffer.slice(start);
      }

      const end = buffer.indexOf(jpegEndMarker, 2);
      if (end < 0) return;

      const jpeg = buffer.slice(0, end + 2);
      buffer = buffer.slice(end + 2);

      if (buffer.indexOf(jpegStartMarker) >= 0) {
        droppedFrames++;
        continue;
      }
      acceptJpegFrame(jpeg);
    }
  });

  rtspProcess.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 1000) stderrBuffer = stderrBuffer.slice(-1000);
  });

  rtspProcess.on('error', (err) => {
    console.error(`[RTSP:${id}] ffmpeg错误:`, err.message);
    cam.status = 'error';
    cam.error = `ffmpeg启动失败: ${err.message}`;
    cam.rtspProcess = null;
    notifyRtspStatus();
  });

  rtspProcess.on('exit', (code, signal) => {
    console.log(`[RTSP:${id}] 退出 code=${code} signal=${signal}`);
    if (cam.status === 'connecting' || cam.status === 'connected') {
      cam.status = 'error';
      cam.error = code !== 0
        ? `ffmpeg异常退出(code=${code}): ${stderrBuffer.trim().split('\n').pop() || '未知错误'}`
        : '连接已断开';
    }
    if (cam.rtspProcess === rtspProcess) {
      cam.rtspProcess = null;
    }
    notifyRtspStatus();
  });

  setTimeout(() => {
    if (cam.rtspProcess === rtspProcess && cam.status === 'connecting') {
      const lastError = stderrBuffer.trim().split('\n').pop();
      console.error(`[RTSP:${id}] 连接超时（15秒无MJPEG帧）`, lastError || '');
      cam.status = 'error';
      cam.error = `连接超时：15秒无视频帧${lastError ? ` (${lastError})` : ''}`;
      stopRtspCamera(id);
      notifyRtspStatus();
    }
  }, 15000);
};

function getLanIps() {
  const ips = [];
  const virtualKeywords = ['vmware', 'virtualbox', 'docker', 'vpn', 'tun', 'tap', 'ppp', 'mihomo', 'veth', 'hyper-v'];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = virtualKeywords.some(v => lowerName.includes(v));

    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4') continue;
      const addr = iface.address;

      // 保留 localhost
      if (iface.internal) {
        if (!ips.includes(addr)) ips.push(addr);
        continue;
      }

      // 排除虚拟网卡（VMware、Mihomo VPN 等）
      if (isVirtual) continue;

      // 排除无效网段
      if (addr.startsWith('169.254.')) continue;               // APIPA
      if (addr.startsWith('198.18.') || addr.startsWith('198.19.')) continue; // 测试/VPN 网段

      if (!ips.includes(addr)) ips.push(addr);
    }
  }

  // 排序：真实局域网 IP 在前，127.0.0.1 在后
  ips.sort((a, b) => {
    const aIsLocal = a.startsWith('127.');
    const bIsLocal = b.startsWith('127.');
    if (aIsLocal && !bIsLocal) return 1;
    if (!aIsLocal && bIsLocal) return -1;
    return 0;
  });

  return ips.length ? ips : ['127.0.0.1'];
}

function writeLog(timestamp, result, isAlert = false, alertDetails = null) {
  const alertMark = isAlert ? ' [ALERT]' : '';
  let line = `[${timestamp}]${alertMark}\n`;
  if (alertDetails?.length) line += `警报详情: ${alertDetails.join(', ')}\n`;
  line += `${result}\n${'-'.repeat(60)}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
}

// 每个摄像头的 JSON 分析日志：按摄像头 ID 分目录，每天一个 .jsonl 文件
function writeCameraJsonLog(cameraId, result) {
  try {
    const camDir = path.join(CAMERA_LOG_DIR, cameraId);
    if (!fs.existsSync(camDir)) {
      fs.mkdirSync(camDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const logFile = path.join(camDir, `${dateStr}.jsonl`);

    // 提取每个技能的原始返回文本
    const skillResults = (result._skillResults || []).map(r => ({
      skillId: r.skillId || r.id || 'unknown',
      skillLabel: r.skillLabel || 'unknown',
      text: r.error ? `[错误] ${r.error}` : (r.result?.text || ''),
      alert: r.error ? false : (r.result?.alert || false),
      timeMs: r.timeMs || 0
    }));

    const entry = {
      timestamp: new Date().toISOString(),
      cameraId,
      text: result.text || '',
      alert: result.alert || false,
      alert_details: result.alert_details || [],
      risk_level: result.risk_level || 'none',
      skillResults
    };

    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.error('[摄像头日志] 写入失败:', e.message);
  }
}


function writeRuntimeFrame(cameraId, jpegBuffer) {
  const safeCamId = safeName(cameraId || 'active', 'active');
  if (!fs.existsSync(RUNTIME_FRAME_DIR)) {
    fs.mkdirSync(RUNTIME_FRAME_DIR, { recursive: true });
  }
  const absPath = resolveInside(RUNTIME_FRAME_DIR, `${safeCamId}.jpg`);
  fs.writeFileSync(absPath, jpegBuffer);
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

function isAudioOnlySkill(skill) {
  const id = skill && (skill.id || skill.name);
  return id === 'audio-detector';
}

function shouldUseFramePathOnly(enabledSkills) {
  if (!Array.isArray(enabledSkills) || enabledSkills.length === 0) return false;
  return enabledSkills.every(skill => {
    const id = skill.id || skill.name;
    return id === 'yolo-safety' || id === 'audio-detector';
  });
}

// ==========================================
// 视频录制管理
// ==========================================
const VIDEO_RECORD_DIR = resolveInside(PROJECT_ROOT, safeName(process.env.RECORDINGS_DIR || 'recordings', 'recordings'));
const RECORD_FPS = 15;                 // 录制帧率
const RECORD_SEGMENT_MIN = 10;         // 每 10 分钟分段一个文件
const RECORD_MIN_INTERVAL_MS = 1000 / RECORD_FPS;// 写入帧最小间隔
const videoRecorders = new Map(); // camId -> { process, filePath, startTime, lastWriteTime }

function getRecordingCamId(camId) {
  return safeName(camId, 'cam');
}

function getRecordingDir(camId) {
  return resolveInside(VIDEO_RECORD_DIR, getRecordingCamId(camId));
}

function getRecordingFileName(fileName) {
  const original = String(fileName || '');
  const cleaned = safeName(original, '');
  if (!cleaned || cleaned !== original || path.extname(cleaned).toLowerCase() !== '.mkv') {
    throw new Error('Invalid recording file name');
  }
  return cleaned;
}

function getRecordingFilePath(camId, fileName) {
  return resolveInside(getRecordingDir(camId), getRecordingFileName(fileName));
}

function getVideoFilePath(camId) {
  const dir = getRecordingDir(camId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  return resolveInside(dir, safeName(`${dateStr}_${timeStr}.mkv`, 'recording.mkv'));
}

function startVideoRecording(camId) {
  const recordingCamId = getRecordingCamId(camId);
  // 如果已经在录制，先停止旧的
  stopVideoRecording(recordingCamId);

  const filePath = getVideoFilePath(recordingCamId);
  const args = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', String(RECORD_FPS),
    '-use_wallclock_as_timestamps', '1',
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '28',
    // MKV 是流式容器，不需要 movflags，进程被 kill 也能正常播放
    filePath
  ];

  const proc = spawn(FFMPEG_PATH, args, {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true
  });

  proc.on('error', (err) => {
    console.error(`[录制:${recordingCamId}] FFmpeg 启动失败:`, err.message);
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[录制:${recordingCamId}] FFmpeg 异常退出code=${code}`);
    }
  });

  const recorder = {
    process: proc,
    filePath,
    startTime: Date.now(),
    lastWriteTime: 0
  };
  videoRecorders.set(recordingCamId, recorder);
  console.log(`[录制:${recordingCamId}] 开始录制-> ${filePath}`);
  return { cameraId: recordingCamId, filePath };
}

function stopVideoRecording(camId) {
  const recordingCamId = getRecordingCamId(camId);
  const recorder = videoRecorders.get(recordingCamId);
  if (!recorder) return;

  videoRecorders.delete(recordingCamId);

  try {
    recorder.process.stdin.end();
  } catch (e) {}

  // 给 FFmpeg 最多 10 秒自然完成编码和写入 moov，不要提前 kill
  const timer = setTimeout(() => {
    try {
      if (recorder.process && !recorder.process.killed) {
        recorder.process.kill('SIGTERM');
      }
    } catch (e) {}
  }, 10000);

  recorder.process.once('close', () => {
    clearTimeout(timer);
  });

  console.log(`[录制:${recordingCamId}] 停止录制`);
}

function writeVideoFrame(camId, jpegBuffer) {
  const recordingCamId = getRecordingCamId(camId);
  let recorder = videoRecorders.get(recordingCamId);

  if (!recorder) {
    return false;
  }

  if (!recorder.process || recorder.process.killed) return false;

  // 帧率控制
  const now = Date.now();
  if (now - recorder.lastWriteTime < RECORD_MIN_INTERVAL_MS) return false;
  recorder.lastWriteTime = now;

  // 写入帧，处理 backpressure
  if (recorder.process.stdin.writableEnded || recorder.process.stdin.destroyed) return false;
  const ok = recorder.process.stdin.write(jpegBuffer);
  if (!ok) {
    // 缓冲区满，等 drain 后再恢复，但这里直接跳过本帧即可
    recorder.process.stdin.once('drain', () => {});
  }
  return ok;
}

function broadcastSSE(data) {
  const payload = JSON.stringify(data);
  const dead = [];
  for (const [id, send] of sseClients) {
    try {
      send(payload);
    } catch (e) {
      dead.push(id);
    }
  }
  for (const id of dead) sseClients.delete(id);
}

// Global function for audio detector events
global.broadcastAudioEvent = function(audioEvent) {
  // Format audio alert for SSE broadcast
  const alertData = {
    alerts: [{
      type: audioEvent.type || 'audio_alert',
      title: audioEvent.title || '音频异常告警',
      severity: audioEvent.severity || 'warning',
      category: audioEvent.category || 'audio',
      categoryCn: audioEvent.category === 'explosion' ? '爆炸声音' : '高分贝声音',
      cameraId: audioEvent.cameraId || 'audio',
      cameraLabel: audioEvent.cameraLabel || '音频检测',
      confidence: 1.0,
      timestamp: audioEvent.timestamp || new Date().toISOString(),
      description: audioEvent.description || '',
      db_level: audioEvent.db_level,
      snapshotPath: audioEvent.snapshotPath || '',
      skillId: 'audio-detector',
      sourceSkill: 'audio-detector'
    }],
    detections: [],
    text: audioEvent.description || '音频检测告警',
    alert: true,
    risk_level: audioEvent.severity === 'critical' ? 'high' : 'medium'
  };
  
  console.log('[SSE] 广播音频告警:', audioEvent.title, audioEvent.db_level, 'dBFS');
  broadcastSSE(alertData);
  
  // 发送企业微信推送
  sendWechatAlert({
    title: audioEvent.title || '音频异常告警',
    description: audioEvent.description || `检测到${audioEvent.category === 'explosion' ? '爆炸' : '高分贝'}声音`,
    camera: audioEvent.cameraId || 'audio',
    cameraLabel: audioEvent.cameraLabel || '音频检测'
  });
};

function getDetectionConfig() {
  return readDetectionConfig({ env: process.env });
}

function getSkillConfigContext() {
  return buildSkillConfigContext(getDetectionConfig());
}


function getAnalysisIntervalMs(config = getDetectionConfig()) {
  const raw = Number(config && config.analysisIntervalMs);
  if (!Number.isFinite(raw)) return 10000;
  return Math.max(500, Math.min(60000, Math.floor(raw)));
}

function getEnabledAnalysisSkills() {
  try {
    if (skillManager && typeof skillManager.getEnabledSkills === 'function') {
      return skillManager.getEnabledSkills();
    }
    if (skillManager && typeof skillManager.getSkillsStatus === 'function') {
      return skillManager.getSkillsStatus().filter(skill => skill.enabled === true);
    }
  } catch (err) {
    console.error('[技能] 读取启用技能失败:', err.message);
  }
  return [];
}

function updateAnalysisPausedState(reason) {
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  aiResult = {
    ...aiResult,
    cameraId: activeCameraId,
    text: reason,
    time: timeStr,
    analyzing: false,
    alert: false,
    alert_message: '',
    alert_details: [],
    voice_reminder: false,
    voice_text: '',
    voice_texts: [],
    risk_level: 'none',
    cleanup_hint: '',
    evacuate_reminder: false,
    evacuate_text: '',
    beep_count: 0,
    damage_voice_text: '',
    damage_alert_details: [],
    damage_beep_count: 0,
    alerts: [],
    detections: []
  };

  broadcastSSE(aiResult);
}

function runAlertQuery(action, payload = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(PYTHON_BIN, [ALERT_HELPER_PATH], {
      cwd: round4Foundation.PROJECT_ROOT,
      windowsHide: true
    });

    const timer = setTimeout(() => {
      finished = true;
      try { child.kill(); } catch (_) {}
      reject(new Error('Alert query helper timed out'));
    }, 3000);

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout || '{}');
        if (code !== 0 && !result.error) {
          result.success = false;
          result.error = stderr.trim() || `Alert query helper exited with code ${code}`;
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Alert query helper returned invalid JSON: ${stderr.trim() || err.message}`));
      }
    });

    child.stdin.end(JSON.stringify({ action, ...payload }));
  });
}

function handleAlertQueryError(res, err) {
  console.error('[alerts-api]', err.message);
  res.status(500).json({ success: false, error: err.message });
}

// ==========================================
// 视频帧处理 (WebRTC)
// ==========================================
let frameCount = 0;
let webrtcInstanceId = 0;

async function processFrame(frame, camId = 'webrtc') {
  try {
    const { width, height, data } = frame;
    const sourceData = Buffer.isBuffer(data) ? Uint8Array.from(data) : data;

    let cam = getCamera(camId);
    if (!cam) {
      cam = createCamera(camId, 'webrtc', `手机推流 (${camId})`);
      cameras.set(camId, cam);
    }

    const rgba = Buffer.alloc(width * height * 4);
    i420ToRgba(
      { width, height, data: sourceData },
      { width, height, data: rgba }
    );

    const jpeg = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .resize(1280, 1280, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();

    cam.latestJpeg = jpeg;
    cam.status = 'connected';
    cam.error = '';
    cam.frameCount = (cam.frameCount || 0) + 1;
    if (activeCameraId === 'webrtc' || !getActiveCamera()?.latestJpeg) {
      activeCameraId = camId;
    }

    writeVideoFrame(camId, jpeg);

    if (cam.frameCount === 1) {
      console.log(`[视频:${camId}] first frame ${width}x${height}, JPEG ${jpeg.length} bytes`);
    } else if (cam.frameCount % 60 === 0) {
      console.log(`[视频:${camId}] processed ${cam.frameCount} frames`);
    }
    return true;
  } catch (e) {
    console.error(`[视频:${camId}] frame processing failed:`, e.message);
    return false;
  }
}

async function processVideoTrack(track, pc, camId) {
  console.log(`[视频:${camId}] creating RTCVideoSink`);
  const sink = new RTCVideoSink(track);
  let active = true;
  let frameQueue = [];
  let isProcessing = false;
  let firstFrameReceived = false;

  if (!getCamera(camId)) {
    const cam = createCamera(camId, 'webrtc', `手机推流 (${camId})`);
    cameras.set(camId, cam);
  }

  const onStateChange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      active = false;
      try { sink.stop(); } catch (_) {}
      stopVideoRecording(camId);
      setTimeout(() => {
        const cam = getCamera(camId);
        if (cam) {
          cam.status = 'disconnected';
          console.log(`[视频:${camId}] disconnected`);
        }
      }, 3000);
    }
  };
  pc.addEventListener('connectionstatechange', onStateChange);

  sink.onframe = ({ frame }) => {
    if (!active) return;
    if (!firstFrameReceived) {
      firstFrameReceived = true;
      console.log(`[视频:${camId}] received first frame: ${frame.width}x${frame.height}`);
    }
    frameQueue.push(frame);
    if (!isProcessing) processLoop();
  };

  async function processLoop() {
    isProcessing = true;
    while (frameQueue.length > 0 && active) {
      const frame = frameQueue[frameQueue.length - 1];
      frameQueue = [];
      await processFrame(frame, camId);
    }
    isProcessing = false;
  }

  await new Promise(resolve => {
    const check = setInterval(() => {
      if (!active) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  pc.removeEventListener('connectionstatechange', onStateChange);
  console.log(`[视频:${camId}] track processing ended`);
}

async function processAudioTrack(track, pc, camId) {
  if (typeof RTCAudioSink !== 'function') {
    const cam = getCamera(camId);
    if (cam) {
      cam.audioStatus = 'unsupported';
      cam.audioError = '当前 wrtc 运行时不支持 RTCAudioSink';
    }
    console.warn(`[音频:${camId}] 当前 wrtc 运行时不支持 RTCAudioSink`);
    return;
  }

  console.log(`[音频:${camId}] creating RTCAudioSink`);
  const sink = new RTCAudioSink(track);
  let active = true;
  let firstAudioReceived = false;

  if (!getCamera(camId)) {
    const cam = createCamera(camId, 'webrtc', `手机推流 (${camId})`);
    cameras.set(camId, cam);
  }

  const cam = getCamera(camId);
  if (cam) {
    cam.audioStatus = 'waiting';
    cam.audioError = '';
  }

  const onStateChange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      active = false;
      try { sink.stop(); } catch (_) {}
      const c = getCamera(camId);
      if (c) c.audioStatus = 'disconnected';
    }
  };
  pc.addEventListener('connectionstatechange', onStateChange);

  sink.ondata = (data) => {
    if (!active) return;
    if (!firstAudioReceived) {
      firstAudioReceived = true;
      console.log(`[音频:${camId}] received first audio frame: sampleRate=${data.sampleRate}, channels=${data.channelCount}`);
    }
    updateAudioMetrics(camId, data);
  };

  await new Promise(resolve => {
    const check = setInterval(() => {
      if (!active) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  pc.removeEventListener('connectionstatechange', onStateChange);
  console.log(`[音频:${camId}] track processing ended`);
}
// ==========================================// AI 定时分析
// ==========================================
let lastPausedReason = '';

async function runAnalysisTick() {
  try {
    if (isAnalyzing) return;

    const config = getDetectionConfig();
    const analysisCameraId = activeCameraId;
    const analysisCamera = getCamera(analysisCameraId);
    const frameJpeg = analysisCamera ? analysisCamera.latestJpeg : null;
    const audioMetrics = getLatestAudioMetrics(analysisCameraId);
    const hasFreshAudio = Boolean(audioMetrics && audioMetrics.fresh);
    const enabledSkills = getEnabledAnalysisSkills();

    if (!frameJpeg && !hasFreshAudio) return;

    if (!enabledSkills.length) {
      const message = '未启用 AI 技能，已暂停分析。摄像头拉流仍会继续，画面预览不受影响。';
      if (lastPausedReason !== message) {
        lastPausedReason = message;
        updateAnalysisPausedState(message);
        console.log('[AI分析暂停] 未启用 AI 技能');
      } else {
        updateAnalysisPausedState(message);
      }
      return;
    }

    const needsImage = enabledSkills.some(skill => !isAudioOnlySkill(skill));
    if (needsImage && !frameJpeg) return;

    lastPausedReason = '';
    isAnalyzing = true;
    const frameCopy = frameJpeg ? Buffer.from(frameJpeg) : Buffer.alloc(0);
    const startTime = Date.now();

    aiResult = {
      ...aiResult,
      cameraId: analysisCameraId,
      analyzing: true,
      text: `正在分析当前画面... 已启用技能 ${enabledSkills.length} 个`,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };
    broadcastSSE(aiResult);

    try {
      const activeCam = analysisCamera;
      const skillConfigContext = buildSkillConfigContext(config);
      let framePath = '';
      if (frameCopy.length > 0) {
        try {
          framePath = writeRuntimeFrame(analysisCameraId, frameCopy);
        } catch (err) {
          console.warn('[analysis] 写入 runtime frame 失败，回退 base64:', err.message);
        }
      }

      const useFramePathOnly = Boolean(framePath) && shouldUseFramePathOnly(enabledSkills);
      const base64 = useFramePathOnly || frameCopy.length === 0 ? '' : frameCopy.toString('base64');

      const analysisContext = {
        type: 'analyze',
        cameraId: analysisCameraId,
        cameraLabel: activeCam ? (activeCam.label || maskCameraUrl(activeCam.url) || analysisCameraId) : analysisCameraId,
        timestamp: Date.now(),
        framePath,
        audio: audioMetrics,
        audioMetrics,
        ...skillConfigContext
      };

      const result = await Promise.race([
        skillManager.analyzeAll(base64, analysisContext),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Analysis timed out after ${ANALYZE_TIMEOUT_MS}ms`)), ANALYZE_TIMEOUT_MS)
        )
      ]);

      const analyzedCamera = getCamera(analysisCameraId);
      if (analyzedCamera) {
        analyzedCamera.latestDetections = Array.isArray(result.detections) ? result.detections : [];
        analyzedCamera.latestDetectionAt = Date.now();
        analyzedCamera.latestAnnotatedJpeg = null;
        analyzedCamera.latestAnnotatedKey = '';
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
      const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);

      aiResult = {
        cameraId: analysisCameraId,
        text: result.text,
        time: timeStr,
        analyzing: false,
        alert: result.alert,
        alert_message: result.alert ? `检测到安全风险: ${(result.alert_details || []).join('; ')}` : '',
        alert_details: result.alert_details || [],
        voice_reminder: result.voice_reminder || false,
        voice_text: result.voice_text || '',
        voice_texts: result.voice_texts || [],
        risk_level: result.risk_level || 'none',
        cleanup_hint: result.cleanup_hint || '',
        evacuate_reminder: result.evacuate_reminder || false,
        evacuate_text: result.evacuate_text || '',
        beep_count: result.beep_count || 0,
        damage_voice_text: result.damage_voice_text || '',
        damage_alert_details: result.damage_alert_details || [],
        damage_beep_count: result.damage_beep_count || 0,
        alerts: result.alerts || [],
        detections: result.detections || []
      };

      writeLog(timestamp, result.text, result.alert, result.alert_details || []);
      writeCameraJsonLog(analysisCameraId, result);
      broadcastSSE(aiResult);

      // 如果有告警，发送企业微信推送
      if (result.alert && result.alerts && result.alerts.length > 0) {
        for (const alert of result.alerts) {
          sendWechatAlert({
            title: alert.title || '系统安全告警',
            description: alert.description || alert.message || result.text,
            camera: alert.cameraId || alert.camera || analysisCameraId,
            cameraLabel: alert.cameraLabel || (analysisCamera ? analysisCamera.label : ''),
            time: alert.timestamp
          });
        }
      }

      console.log(`[分析成功] ${timeStr}, 启用技能 ${enabledSkills.length} 个, ${useFramePathOnly ? 'framePath' : 'base64'}, 耗时 ${Date.now() - startTime}ms`);
    } catch (e) {
      const errMsg = `分析异常: ${e.message}`;
      const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

      aiResult = {
        ...aiResult,
        cameraId: analysisCameraId,
        text: errMsg,
        analyzing: false,
        time: timeStr,
        voice_reminder: false,
        voice_text: '',
        voice_texts: [],
        risk_level: 'none',
        cleanup_hint: '',
        evacuate_reminder: false,
        evacuate_text: '',
        beep_count: 0,
        alerts: [],
        detections: []
      };

      writeLog(timestamp, errMsg);
      writeCameraJsonLog(analysisCameraId, { text: errMsg, alert: false, alert_details: [], risk_level: 'none', _skillResults: [] });
      broadcastSSE(aiResult);
      console.error('[分析异常]', e.message);
    } finally {
      isAnalyzing = false;
    }
  } finally {
    setTimeout(runAnalysisTick, getAnalysisIntervalMs());
  }
}

setTimeout(runAnalysisTick, 1000);

// ==========================================
// Express 应用
// ==========================================
const app = express();

function rejectWebSkillInstallation(req, res) {
  res.status(403).json({
    success: false,
    error: 'Web skill installation is disabled for security reasons'
  });
}

app.post('/api/skills/install', rejectWebSkillInstallation);
app.post('/api/skills/install-path', rejectWebSkillInstallation);

app.use(express.json({ limit: '50mb' }));

// CORS：支持 nginx 独立部署的前端跨域访问// 如需限制特定域名，设置环境变量CORS_ORIGIN=https://your-nginx-domain.com
app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Static pages.
app.get('/', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  const clientPath = path.join(htmlDir, 'webrtc-client.html');
  if (fs.existsSync(clientPath)) {
    res.sendFile(clientPath);
  } else {
    res.status(404).send('webrtc-client.html not found (deployed separately via nginx)');
  }
});

app.get('/monitor', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'dashboard.html'));
});

app.get('/recordings', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'recordings.html'));
});

app.get('/events', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'events.html'));
});

app.get('/settings', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'settings.html'));
});

app.get('/dashboard', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'dashboard.html'));
});

app.get('/desktop', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'desktop-capture.html'));
});

// Test page for region capture analysis.
app.get('/test', (req, res) => {
  const htmlDir = process.env.HTML_DIR || path.join(PROJECT_ROOT, 'html');
  res.sendFile(path.join(htmlDir, 'test-capture.html'));
});

// WebRTC 信令
app.post('/offer', async (req, res) => {
  try {
    webrtcInstanceId++;
    const camId = `webrtc-${webrtcInstanceId}`;
    console.log(`[信令] 收到前端 offer #${webrtcInstanceId}, 分配摄像头 ${camId}`);
    const { sdp, type, label } = req.body;
    const offer = new RTCSessionDescription({ sdp, type });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections.add(pc);

    // Track each WebRTC sender as its own camera.
    const camLabel = label || `WebRTC ${webrtcInstanceId}`;
    const cam = createCamera(camId, 'webrtc', camLabel);
    cam.label = camLabel;
    cameras.set(camId, cam);
    activeCameraId = camId;
    console.log(`已注册摄像头: ${camId}`);

    pc.addEventListener('connectionstatechange', () => {
      console.log(`[WebRTC:${camId}] 连接状态`, pc.connectionState);
      if (['failed', 'closed'].includes(pc.connectionState)) {
        pc.close();
        peerConnections.delete(pc);
        // Delay cleanup so clients can read the final disconnected state.
        setTimeout(() => {
          if (cameras.has(camId)) {
            const c = getCamera(camId);
            if (c) c.status = 'disconnected';
          }
        }, 3000);
      }
    });

    pc.addEventListener('icegatheringstatechange', () => {
      console.log(`[WebRTC:${camId}] ICE 收集状态`, pc.iceGatheringState);
    });

    pc.addEventListener('track', (event) => {
      console.log(`[WebRTC:${camId}] track 事件, kind:`, event.track.kind);
      if (event.track.kind === 'video') {
        console.log(`[WebRTC:${camId}] video track connected`);
        processVideoTrack(event.track, pc, camId).catch(console.error);
      } else if (event.track.kind === 'audio') {
        console.log(`[WebRTC:${camId}] audio track connected`);
        processAudioTrack(event.track, pc, camId).catch(console.error);
      }
    });

    await pc.setRemoteDescription(offer);
    console.log('[信令] setRemoteDescription 成功');

    const answer = await pc.createAnswer();
    console.log('[信令] createAnswer 成功');

    await pc.setLocalDescription(answer);
    console.log('[信令] setLocalDescription 成功, ICE 状态', pc.iceGatheringState);

    // 等待 ICE gathering 完成，确保 answer 包含完整的 candidates
    if (pc.iceGatheringState !== 'complete') {
      console.log('等待 ICE candidates 收集...');
      await new Promise((resolve) => {
        let resolved = false;

        const onIceComplete = () => {
          if (pc.iceGatheringState === 'complete' && !resolved) {
            resolved = true;
            pc.removeEventListener('icegatheringstatechange', onIceComplete);
            clearTimeout(timer);
            resolve();
          }
        };

        pc.addEventListener('icegatheringstatechange', onIceComplete);

        // 5 秒兜底：即使没收到 complete，也返回已有 candidates
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            pc.removeEventListener('icegatheringstatechange', onIceComplete);
            console.log('ICE 收集超时，使用已收集 candidates');
            resolve();
          }
        }, 5000);
      });
    }

    console.log('[信令] 返回 answer, candidates 已包含', pc.localDescription.sdp.includes('candidate'));

    res.json({
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type
    });
  } catch (e) {
    console.error('[信令] 错误:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Latest frame for the active camera.
app.get('/api/frame', (req, res) => {
  const frameJpeg = getLatestFrameJpeg();
  if (!frameJpeg) {
    return res.status(404).send('No frame available');
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.set('X-Camera-Id', activeCameraId);
  res.send(frameJpeg);
});

// Latest frame for a specific camera.
app.get('/api/cameras/:id/frame', (req, res) => {
  const cam = getCamera(req.params.id);
  if (!cam || !cam.latestJpeg) {
    return res.status(404).send('No frame available');
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.set('X-Camera-Id', cam.id);
  res.send(cam.latestJpeg);
});

// MJPEG stream for active camera.
app.get('/api/stream', (req, res) => {
  sendMjpegStream(req, res, 'active');
});

// MJPEG stream for a specific camera.
app.get('/api/cameras/:id/stream', (req, res) => {
  sendMjpegStream(req, res, req.params.id);
});

// 获取当前 active 摄像头的音频状态
app.get('/api/audio/status', (req, res) => {
  const activeAudio = getLatestAudioMetrics(activeCameraId);
  res.json({
    success: true,
    active: activeCameraId,
    audio: activeAudio,
    cameras: Array.from(cameras.values()).map(camera => ({
      id: camera.id,
      label: camera.label,
      audioStatus: camera.audioStatus || 'idle',
      hasAudio: !!(camera.latestAudio && Date.now() - camera.latestAudio.lastAt <= 3000),
      audio: getLatestAudioMetrics(camera.id)
    }))
  });
});

// 获取 AI 分析结果
app.get('/api/analysis', (req, res) => {
  res.json(aiResult);
});

app.get('/api/detection/config', (req, res) => {
  try {
    res.json({ success: true, config: getDetectionConfig() });
  } catch (err) {
    console.error('[detection-config] read failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/detection/config', (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ success: false, error: 'Detection config must be JSON' });
  }
  try {
    const config = writeDetectionConfig(req.body || {}, { env: process.env });
    res.json({ success: true, config });
  } catch (err) {
    const status = /^Invalid|^Unsupported|must be/.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.get('/api/alerts', async (req, res) => {
  try {
    const result = await runAlertQuery('list', { query: req.query || {} });
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Failed to query alerts' });
    }
    res.json(result);
  } catch (err) {
    handleAlertQueryError(res, err);
  }
});

app.get('/api/alerts/:id/snapshot', async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid alert id' });
  try {
    const result = await runAlertQuery('snapshot', { id });
    if (!result.success) {
      return res.status(result.notFound ? 404 : 500).json({
        success: false,
        error: result.error || 'Snapshot not found'
      });
    }
    let snapshotFile;
    try {
      snapshotFile = resolveAlertSnapshotPath(result.snapshot_path);
    } catch (err) {
      return res.status(403).json({ success: false, error: err.message });
    }
    if (!fs.existsSync(snapshotFile)) {
      return res.status(404).json({ success: false, error: 'Snapshot file not found' });
    }
    res.set('Cache-Control', 'private, max-age=60');
    res.sendFile(snapshotFile);
  } catch (err) {
    handleAlertQueryError(res, err);
  }
});

app.get('/api/alerts/:id', async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid alert id' });
  try {
    const result = await runAlertQuery('detail', { id });
    if (!result.success) {
      return res.status(result.notFound ? 404 : 500).json({
        success: false,
        error: result.error || 'Alert not found'
      });
    }
    res.json(result);
  } catch (err) {
    handleAlertQueryError(res, err);
  }
});

// 测试页面：上传图片区域进行 AI 分析
app.post('/api/test-analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: '缺少 imageBase64 参数' });
    }

    console.log('[测试分析] 收到图片，开始调用 AI 技能...');
    const startTime = Date.now();
    const result = await skillManager.analyzeAll(imageBase64, {
      type: 'analyze',
      cameraId: 'test',
      timestamp: Date.now(),
      ...getSkillConfigContext()
    });
    console.log(`[测试分析] 完成，耗时 ${Date.now() - startTime}ms`);

    res.json(result);
  } catch (e) {
    console.error('[测试分析] 错误:', e.message);
    res.status(500).json({ error: e.message, text: '分析异常: ' + e.message, alert: false, alert_details: [] });
  }
});

// SSE realtime stream.
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const clientId = Date.now() + Math.random();
  const send = (data) => res.write(`data: ${data}\n\n`);
  sseClients.set(clientId, send);

  // Send the current state immediately on connect.
  send(JSON.stringify(aiResult));

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

// ==========================================
// 多摄像头管理 API
// ==========================================
app.get('/api/cameras', (req, res) => {
  res.json({
    cameras: getAllCameraList(),
    active: activeCameraId
  });
});

app.post('/api/cameras', (req, res) => {
  try {
    const url = normalizeRtspUrl(req.body?.url);
    const sourceType = normalizeSourceType(req.body?.sourceType);
    cameraIdCounter++;
    const camId = `cam-${cameraIdCounter}`;
    const cam = createCamera(camId, 'rtsp', url, {
      label: sanitizeCameraLabel(req.body?.label, `摄像头 ${cameraIdCounter}`),
      sourceType
    });
    cameras.set(camId, cam);
    persistCameraConfig();

    if (req.body?.autoStart === true) {
      startRtspCamera(camId, url);
    }

    console.log(`[摄像头] 新增: ${camId} -> ${maskCameraUrl(url)}`);
    res.json({ success: true, camera: publicCamera(cam), active: activeCameraId });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/cameras/:id', (req, res) => {
  const id = req.params.id;
  const cam = getCamera(id);
  if (!cam) return res.status(404).json({ success: false, error: '摄像头不存在' });

  try {
    const { label, url, sourceType } = req.body || {};
    if (label !== undefined) cam.label = sanitizeCameraLabel(label, cam.id);
    if (sourceType !== undefined) cam.sourceType = normalizeSourceType(sourceType);
    if (url !== undefined && url !== cam.url) {
      const nextUrl = normalizeRtspUrl(url);
      stopRtspCamera(id);
      cam.url = nextUrl;
      if (req.body?.autoStart === true) {
        startRtspCamera(id, nextUrl);
      }
    }

    persistCameraConfig();
    console.log(`[摄像头] 已更新 ${id} label="${cam.label || ''}" url="${maskCameraUrl(cam.url)}"`);
    res.json({ success: true, camera: publicCamera(cam), active: activeCameraId });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});
app.delete('/api/cameras/:id', (req, res) => {
  const id = req.params.id;
  if (id === 'webrtc') {
    return res.status(400).json({ success: false, error: 'Cannot delete the default WebRTC camera' });
  }

  const cam = getCamera(id);
  if (!cam) {
    return res.status(404).json({ success: false, error: 'Camera not found' });
  }

  stopVideoRecording(id);
  stopRtspCamera(id);
  cameras.delete(id);

  if (activeCameraId === id) {
    activeCameraId = 'webrtc';
  }

  persistCameraConfig();
  console.log(`[camera] deleted ${id}`);
  res.json({ success: true, active: activeCameraId });
});

app.post('/api/cameras/:id/start', (req, res) => {
  const id = req.params.id;
  const cam = getCamera(id);
  if (!cam) return res.status(404).json({ success: false, error: 'Camera not found' });
  if (cam.type !== 'rtsp') return res.status(400).json({ success: false, error: 'Only RTSP cameras can be started by this endpoint' });

  startRtspCamera(id, cam.url);
  res.json({ success: true, status: cam.status });
});

app.post('/api/cameras/:id/stop', (req, res) => {
  const id = req.params.id;
  const cam = getCamera(id);
  if (!cam) return res.status(404).json({ success: false, error: 'Camera not found' });

  stopRtspCamera(id);
  res.json({ success: true });
});

// Switch active camera.
app.post('/api/cameras/active', (req, res) => {
  const { id } = req.body;
  if (!id || !cameras.has(id)) {
    return res.status(400).json({ success: false, error: 'Invalid camera id' });
  }
  activeCameraId = id;
  persistCameraConfig();
  console.log(`[camera] active ${id}`);
  res.json({ success: true, active: activeCameraId });
});

// ==========================================
// RTSP 拉流管理（旧版兼容 - 操作固定 camera 或 webrtc 摄像头）
// ==========================================

/**
 * 旧版兼容 - 启动 RTSP 流（覆盖 webrtc 摄像头为 rtsp 模式） */
function startRtspStream(url) {
  const cam = getCamera('webrtc');
  if (cam) {
    cam.type = 'rtsp';
    cam.label = 'RTSP Stream';
    rtspUrl = url;
    rtspStatus = 'connecting';
    rtspError = '';
    rtspFrameCount = 0;
    startRtspCamera('webrtc', url);
  }
}

function stopRtspStream() {
  stopRtspCamera('webrtc');
  const cam = getCamera('webrtc');
  if (cam) {
    cam.type = 'webrtc';
    cam.label = '手机推流';
  }
  rtspStatus = 'disconnected';
  rtspUrl = '';
  rtspError = '';
  rtspFrameCount = 0;
  notifyRtspStatus();
}

function syncLegacyState() {
  const cam = getCamera('webrtc');
  if (cam) {
    rtspStatus = cam.status;
    rtspError = cam.error;
    rtspFrameCount = cam.frameCount;
    if (cam.url && cam.type === 'rtsp') rtspUrl = cam.url;
  }
}

function getRtspInfo() {
  syncLegacyState();
  return {
    status: rtspStatus,
    url: maskCameraUrl(rtspUrl),
    error: rtspError,
    frameCount: rtspFrameCount,
  };
}

function notifyRtspStatus() {
  syncLegacyState();
  if (process.send) {
    process.send({ type: 'rtsp-status', data: getRtspInfo() });
  }
}

// RTSP API 路由（旧版兼容）
app.post('/api/rtsp/start', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('rtsp://')) {
    return res.status(400).json({ error: 'Invalid RTSP URL. Must start with rtsp://' });
  }
  startRtspStream(url);
  res.json({ success: true, message: '正在连接 RTSP 流...', ...getRtspInfo() });
});

app.post('/api/rtsp/stop', (req, res) => {
  stopRtspStream();
  res.json({ success: true, message: 'RTSP 流已断开', ...getRtspInfo() });
});

app.get('/api/rtsp/status', (req, res) => {
  res.json(getRtspInfo());
});

// Server info.
app.get('/api/info', (req, res) => {
  const ips = getLanIps();
  res.json({
    ips,
    port: PORT,
    urls: {
      client: ips.map(ip => `https://${ip}:${PORT}`),
      dashboard: ips.map(ip => `https://${ip}:${PORT}/dashboard`),
      monitor: ips.map(ip => `https://${ip}:${PORT}/monitor`)
    }
  });
});

// ==========================================
// 技能管理 API (v2 - 多技能 + 开关 + 文件加载)
// ==========================================

// Get all skill states.
app.get('/api/skills', (req, res) => {
  try {
    const skills = skillManager.getSkillsStatus();
    const active = skillManager.getActiveSkillInfo();
    const failed = skillManager.getFailedSkills();
    res.json({ skills, active, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 切换技能启用/禁用
app.post('/api/skills/toggle', (req, res) => {
  try {
    const { skill, enabled } = req.body;
    if (!skill) {
      return res.status(400).json({ error: '缺少 skill 参数' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '缺少 enabled 参数 (boolean)' });
    }
    const result = skillManager.toggleSkill(skill, enabled);
    res.json({
      success: true,
      skill: result,
      message: enabled ? `已启用 ${result.label}` : `已禁用 ${result.label}`
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Compatibility endpoint: explicitly switch to one enabled skill.
app.post('/api/skills/load', (req, res) => {
  try {
    const { skill } = req.body;
    if (!skill) {
      return res.status(400).json({ error: '缺少 skill 参数' });
    }
    const all = skillManager.getSkillsStatus();
    for (const p of all) {
      if (p.enabled) skillManager.toggleSkill(p.id, false);
    }
    const result = skillManager.toggleSkill(skill, true);
    res.json({
      success: true,
      active: { id: result.id, label: result.label },
      message: 'Switched to ' + result.label + '; other skills disabled'
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/skills/audio-detector/devices', async (req, res) => {
  try {
    const result = await skillManager.executeSkillAction('audio-detector', 'get_devices');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/skills/audio-detector/config', async (req, res) => {
  try {
    const result = await skillManager.executeSkillAction('audio-detector', 'get_config');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/audio-detector/device', async (req, res) => {
  try {
    const { device_id, device_name } = req.body;
    const result = await skillManager.executeSkillAction('audio-detector', 'set_device', { device_id, device_name });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/audio-detector/config', async (req, res) => {
  try {
    const { alert_cooldown, detection_threshold, explosion_threshold } = req.body;
    const result = await skillManager.executeSkillAction('audio-detector', 'update_config', {
      alert_cooldown,
      detection_threshold,
      explosion_threshold
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 录制管理 API
// ==========================================

// 扫描录制目录，返回所有摄像头（含录制文件与状态）
function getRecordingList() {
  const result = [];
  const allCamIds = new Set();

  // 1. 收集所有已知摄像头
  for (const [id, cam] of cameras) {
    allCamIds.add(id);
  }
  // 2. 收集有录制文件的摄像头（即使已删除）
  if (fs.existsSync(VIDEO_RECORD_DIR)) {
    for (const camId of fs.readdirSync(VIDEO_RECORD_DIR)) {
      allCamIds.add(getRecordingCamId(camId));
    }
  }

  for (const camId of allCamIds) {
    const cam = getCamera(camId);
    const files = [];
    const recordingCamId = getRecordingCamId(camId);
    const camDir = getRecordingDir(recordingCamId);
    if (fs.existsSync(camDir) && fs.statSync(camDir).isDirectory()) {
      for (const file of fs.readdirSync(camDir)) {
        if (!file.endsWith('.mkv')) continue;
        const filePath = getRecordingFilePath(recordingCamId, file);
        const stat = fs.statSync(filePath);
        files.push({
          name: file,
          size: stat.size,
          sizeMb: (stat.size / 1024 / 1024).toFixed(2),
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString()
        });
      }
    }

    files.sort((a, b) => b.created.localeCompare(a.created));
    result.push({
      cameraId: recordingCamId,
      isRecording: videoRecorders.has(recordingCamId),
      status: cam ? cam.status : 'unknown',
      label: cam ? (cam.label || cam.url || recordingCamId) : recordingCamId,
      files
    });
  }

  result.sort((a, b) => a.cameraId.localeCompare(b.cameraId));
  return result;
}

app.get('/api/recordings', (req, res) => {
  res.json({ recordings: getRecordingList() });
});

// Start manual recording.
app.post('/api/recordings/:id/start', (req, res) => {
  const result = startVideoRecording(req.params.id);
  res.json({ success: true, cameraId: result.cameraId, isRecording: true });
});

// 停止录制
app.post('/api/recordings/:id/stop', (req, res) => {
  const id = getRecordingCamId(req.params.id);
  stopVideoRecording(id);
  res.json({ success: true, cameraId: id, isRecording: false });
});

// 删除录制文件
app.delete('/api/recordings/:camId/:fileName', (req, res) => {
  const { camId, fileName } = req.params;
  let filePath;
  try {
    filePath = getRecordingFilePath(camId, fileName);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    fs.unlinkSync(filePath);
    console.log('[recording] deleted ' + filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取录制文件的完整路径（用于打开文件夹）
app.get('/api/recordings/:camId/:fileName/path', (req, res) => {
  const { camId, fileName } = req.params;
  let filePath;
  try {
    filePath = getRecordingFilePath(camId, fileName);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  // 返回绝对路径
  res.json({ 
    success: true,
    filePath: path.resolve(filePath),
    directory: path.dirname(path.resolve(filePath)),
    fileName: path.basename(filePath)
  });
});

// 提供录制文件下载/播放（直接读取文件）
app.get('/api/recordings/:camId/:fileName', (req, res) => {
  const { camId, fileName } = req.params;
  let filePath;
  let safeFileName;
  try {
    safeFileName = getRecordingFileName(fileName);
    filePath = getRecordingFilePath(camId, safeFileName);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Type', 'video/x-matroska');
  res.setHeader('Content-Disposition', 'inline; filename="' + safeFileName + '"');
  res.sendFile(filePath);
});

if (process.env.CYPHER_TEST_FRAME_ENDPOINT === '1') {
  app.post('/api/test/frame', async (req, res) => {
    try {
      const width = Number(req.body?.width);
      const height = Number(req.body?.height);
      const dataBase64 = String(req.body?.data || '');
      if (!width || !height) {
        return res.status(400).json({ success: false, error: 'Missing width or height frame' });
      }
      const cameraId = safeText(req.body?.cameraId, 'test-camera').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'test-camera';
      let data = dataBase64 ? Buffer.from(dataBase64, 'base64') : Buffer.alloc(0);
      const expectedLength = Math.floor(width * height * 1.5);
      if (data.length !== expectedLength) {
        data = Buffer.alloc(expectedLength, 128);
      }
      const processed = await processFrame({ width, height, data }, cameraId);
      if (!processed) {
        return res.status(500).json({ success: false, error: 'Frame processing failed' });
      }
      const cam = getCamera(cameraId);
      res.json({ success: true, cameraId, frameCount: cam ? cam.frameCount : 0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

// Global error handler: return JSON instead of an HTML error page.
app.use((err, req, res, next) => {
  console.error('[Express] Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ==========================================
// HTTPS startup
// ==========================================
const sslOptions = {
  key: fs.readFileSync(process.env.KEY_PATH || path.join(PROJECT_ROOT, 'key.pem')),
  cert: fs.readFileSync(process.env.CERT_PATH || path.join(PROJECT_ROOT, 'cert.pem'))
};

let httpsServer = null;

async function startServer() {
  if (!process.env.PORT && !process.env.NODE_PORT) {
    try {
      PORT = await findAvailablePort(PORT);
    } catch (e) {
      console.error('[port] failed to find an available port:', e.message);
      process.exit(1);
    }
  }

  // 启动企业微信推送
  startWechatPush();

  httpsServer = https.createServer(sslOptions, app);
  httpsServer.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIps();
    const lanIps = ips.filter(ip => !ip.startsWith('127.'));
    const localIps = ips.filter(ip => ip.startsWith('127.'));

    console.log('='.repeat(60));
    console.log('CYPHER Node server started');
    console.log('[port] ' + PORT);

    if (lanIps.length > 0) {
      const mainIp = lanIps[0];
      console.log('[LAN]');
      console.log('  https://' + mainIp + ':' + PORT + '            (camera sender)');
      console.log('  https://' + mainIp + ':' + PORT + '/dashboard  (main UI)');
      console.log('  https://' + mainIp + ':' + PORT + '/monitor    (compat entry)');
      lanIps.slice(1).forEach(ip => console.log('  https://' + ip + ':' + PORT));
    }

    if (localIps.length > 0) {
      console.log('[local]');
      localIps.forEach(ip => {
        console.log('  https://' + ip + ':' + PORT);
        console.log('  https://' + ip + ':' + PORT + '/dashboard');
      });
    }

    const failed = skillManager.getFailedSkills();
    if (failed.length > 0) {
      console.warn('[skills] Some skills failed to load and were skipped:');
      for (const f of failed) {
        console.warn('  - ' + f.label + ' (' + f.id + '): ' + f.reason);
      }
    }

    console.log('='.repeat(60));
  });
}

startServer();

// 监听来自 Electron 主进程的 IPC 消息（当通过 fork 启动时）
if (process.send) {
  process.on('message', (msg) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'start-rtsp':
        if (msg.url) {
          startRtspStream(msg.url);
          process.send({ type: 'rtsp-status', data: getRtspInfo() });
        }
        break;
      case 'start-camera':
        if (msg.url && msg.id) {
          startRtspCamera(msg.id, msg.url);
          process.send({ type: 'camera-status', data: { id: msg.id, ...getCamera(msg.id) } });
        }
        break;
      case 'stop-rtsp':
        stopRtspStream();
        process.send({ type: 'rtsp-status', data: getRtspInfo() });
        break;
      case 'stop-camera':
        if (msg.id) {
          stopRtspCamera(msg.id);
          process.send({ type: 'camera-status', data: { id: msg.id, ...getCamera(msg.id) } });
        }
        break;
      case 'get-rtsp-status':
        process.send({ type: 'rtsp-status', data: getRtspInfo() });
        break;
      case 'get-cameras':
        process.send({ type: 'camera-list', data: { cameras: getAllCameraList(), active: activeCameraId } });
        break;
      case 'delete-camera':
        if (msg.id && msg.id !== 'webrtc') {
          stopRtspCamera(msg.id);
          cameras.delete(msg.id);
          if (activeCameraId === msg.id) activeCameraId = 'webrtc';
          process.send({ type: 'camera-list', data: { cameras: getAllCameraList(), active: activeCameraId } });
        }
        break;
      case 'set-active-camera':
        if (msg.id && cameras.has(msg.id)) {
          activeCameraId = msg.id;
          process.send({ type: 'camera-list', data: { cameras: getAllCameraList(), active: activeCameraId } });
        }
        break;
      case 'load-skill':
        try {
          const all = skillManager.getSkillsStatus();
          for (const p of all) {
            if (p.enabled) skillManager.toggleSkill(p.id, false);
          }
          const result = skillManager.toggleSkill(msg.skill, true);
          process.send({ type: 'skill-loaded', data: { id: result.id, label: result.label } });
        } catch (e) {
          process.send({ type: 'skill-error', error: e.message });
        }
        break;
      case 'toggle-skill':
        try {
          const result = skillManager.toggleSkill(msg.skill, typeof msg.enabled === 'boolean' ? msg.enabled : true);
          process.send({ type: 'skill-toggled', data: result });
        } catch (e) {
          process.send({ type: 'skill-error', error: e.message });
        }
        break;
      case 'install-skill':
        try {
          const result = skillManager.installSkillFromContent(msg.fileName, msg.content);
          process.send({ type: 'skill-installed', data: result });
        } catch (e) {
          process.send({ type: 'skill-error', error: e.message });
        }
        break;
      case 'list-skills':
        process.send({
          type: 'skill-list',
          data: {
            skills: skillManager.getSkillsStatus(),
            active: skillManager.getActiveSkillInfo(),
            failed: skillManager.getFailedSkills()
          }
        });
        break;

    }
  });
}

async function cleanupRuntime() {
  for (const camId of Array.from(videoRecorders.keys())) {
    stopVideoRecording(camId);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const id of Array.from(cameras.keys())) {
    stopRtspCamera(id);
  }
  for (const pc of Array.from(peerConnections)) {
    try { await pc.close(); } catch (_) {}
  }
  peerConnections.clear();
  
  // 关闭企业微信推送进程
  if (wechatPushProcess) {
    try {
      wechatPushProcess.stdin.write(JSON.stringify({ shutdown: true }) + '\n');
      wechatPushProcess.kill();
    } catch (e) {
      console.error('[WeChat Push] 关闭失败:', e.message);
    }
    wechatPushProcess = null;
  }
}

process.on('SIGINT', async () => {
  console.log('\n[shutdown] SIGINT received');
  await cleanupRuntime();
  if (httpsServer) {
    httpsServer.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n[shutdown] SIGTERM received');
  await cleanupRuntime();
  process.exit(0);
});

process.on('exit', (code) => {
  if (videoRecorders.size > 0) {
    console.log('[recording] process exit code=' + code + ', closing recorders');
    for (const camId of videoRecorders.keys()) {
      const recorder = videoRecorders.get(camId);
      if (recorder && recorder.process) {
        try { recorder.process.stdin.end(); } catch (e) {}
      }
    }
  }
});
