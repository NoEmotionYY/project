/**
 * Node.js 鏍稿績鏈嶅姟
 * 鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API
 */
require('dotenv').config();

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

// ========== 鍚姩璇婃柇鏃ュ織 ==========
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
// ========== 鍚姩璇婃柇鏃ュ織缁撴潫 ==========

const sharp = require('sharp');
const { RTCPeerConnection, RTCSessionDescription } = require('@roamhq/wrtc');
const { RTCVideoSink, i420ToRgba } = require('@roamhq/wrtc').nonstandard;
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
  console.log('[ffmpeg] 浣跨敤 .env FFMPEG_PATH:', FFMPEG_PATH);
} else try {
  FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
  console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH);
} catch (e) {
  FFMPEG_PATH = 'ffmpeg'; // 鍥為€€鍒扮郴缁?PATH
  console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg');
}

// ==========================================
// 閰嶇疆
// ==========================================
let PORT = parseInt(process.env.PORT || process.env.NODE_PORT, 10) || 8082;
const ANALYSIS_INTERVAL = 1; // analysis interval seconds
const LOG_FILE = path.join(process.env.LOG_DIR || __dirname, 'ai_analysis_log.txt');
const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織

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
// 鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?// ==========================================
const skillManager = requireProjectModule('skill-manager');
let aiSkill; // 鍚戝悗鍏煎锛屼繚鐣欏紩鐢?
// Ensure at least one default skill is enabled on startup.
try {
  const defaultSkill = process.env.AI_SKILL || 'qwen-vl';
  const status = skillManager.getSkillsStatus();
  const hasEnabled = status.some(p => p.enabled);

  if (!hasEnabled) {
    skillManager.toggleSkill(defaultSkill, true);
    console.log(`[技能] 默认启用: ${defaultSkill}`);
  } else {
    console.log(`[技能] 已启用 ${status.filter(p => p.enabled).length} 个技能`);
  }
  aiSkill = skillManager;
} catch (e) {
  console.error('[技能] 初始化失败:', e.message);
  process.exit(1);
}
// ==========================================
// 鍏ㄥ眬鐘舵€?// ==========================================
let isAnalyzing = false;
let activeCameraId = 'webrtc';  // current active camera
let cameraIdCounter = 0;

let aiResult = {
  text: '绛夊緟鍒嗘瀽...',
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
// 澶氭憚鍍忓ご绠＄悊
// ==========================================
// cameras: Map<id, { id, type:'rtsp'|'webrtc', url, status, error, frameCount, latestJpeg, rtspProcess }>
const cameras = new Map();

const RTSP_WIDTH = 1280;
const RTSP_HEIGHT = 720;
const RTSP_FPS = 10;

function sanitizeCameraLabel(input, fallback) {
  return safeText(input, fallback).replace(/[<>]/g, '').slice(0, 80) || fallback;
}

function normalizeRtspUrl(url) {
  const value = safeText(url);
  if (!/^rtsp:\/\//i.test(value)) {
    throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃');
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
    hasFrame: !!c.latestJpeg
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
    console.warn('[camera-config] 淇濆瓨澶辫触:', err.message);
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
    frameEndpoint: '/api/cameras/' + encodeURIComponent(camera.id) + '/frame'
  };
}

// Initialize default WebRTC camera.
cameras.set('webrtc', createCamera('webrtc', 'webrtc', '手机推流'));
loadConfiguredCameras();

// 鏃х増鍏煎
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
  console.log(`[RTSP:${id}] 宸叉柇寮€`);
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

  console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`);
  notifyRtspStatus();

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${RTSP_WIDTH}x${RTSP_HEIGHT}`,
    '-r', String(RTSP_FPS),
    '-an',
    '-v', 'error',
    'pipe:1'
  ];

  cam.rtspProcess = spawn(FFMPEG_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const frameSize = RTSP_WIDTH * RTSP_HEIGHT * 4;
  let buffer = Buffer.alloc(0);
  let stderrBuffer = '';

  cam.rtspProcess.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= frameSize) {
      const frameData = buffer.slice(0, frameSize);
      buffer = buffer.slice(frameSize);
      if (buffer.length >= frameSize) { continue; }

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
            console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message);
          }
        });
    }
  });

  cam.rtspProcess.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 500) stderrBuffer = stderrBuffer.slice(-500);
  });

  cam.rtspProcess.on('error', (err) => {
    console.error(`[RTSP:${id}] ffmpeg 閿欒:`, err.message);
    cam.status = 'error';
    cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`;
    cam.rtspProcess = null;
    notifyRtspStatus();
  });

  cam.rtspProcess.on('exit', (code, signal) => {
    console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`);
    if (cam.status === 'connecting' || cam.status === 'connected') {
      cam.status = 'error';
      cam.error = code !== 0
        ? `ffmpeg 寮傚父閫€鍑?code=${code}): ${stderrBuffer.trim().split('\n').pop() || '鏈煡閿欒'}`
        : '杩炴帴宸叉柇寮€';
    }
    cam.rtspProcess = null;
    notifyRtspStatus();
  });

  setTimeout(() => {
    if (cam.status === 'connecting') {
      console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`);
      cam.status = 'error';
      cam.error = '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘';
      stopRtspCamera(id);
      notifyRtspStatus();
    }
  }, 10000);
}

// ==========================================
// 宸ュ叿鍑芥暟
// ==========================================
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

      // 淇濈暀 localhost
      if (iface.internal) {
        if (!ips.includes(addr)) ips.push(addr);
        continue;
      }

      // 鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級
      if (isVirtual) continue;

      // 鎺掗櫎鏃犳晥缃戞
      if (addr.startsWith('169.254.')) continue;               // APIPA
      if (addr.startsWith('198.18.') || addr.startsWith('198.19.')) continue; // 娴嬭瘯/VPN 缃戞

      if (!ips.includes(addr)) ips.push(addr);
    }
  }

  // 鎺掑簭锛氱湡瀹炲眬鍩熺綉 IP 鍦ㄥ墠锛?27.0.0.1 鍦ㄥ悗
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
  if (alertDetails?.length) line += `璀︽姤璇︽儏: ${alertDetails.join(', ')}\n`;
  line += `${result}\n${'-'.repeat(60)}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
}

// 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織锛氭寜鎽勫儚澶?ID 鍒嗙洰褰曪紝姣忓ぉ涓€涓?.jsonl 鏂囦欢
function writeCameraJsonLog(cameraId, result) {
  try {
    const camDir = path.join(CAMERA_LOG_DIR, cameraId);
    if (!fs.existsSync(camDir)) {
      fs.mkdirSync(camDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const logFile = path.join(camDir, `${dateStr}.jsonl`);

    // 鎻愬彇姣忎釜鎶€鑳界殑鍘熷杩斿洖鏂囨湰
    const skillResults = (result._skillResults || []).map(r => ({
      skillId: r.skillId || r.id || 'unknown',
      skillLabel: r.skillLabel || 'unknown',
      text: r.error ? `[閿欒] ${r.error}` : (r.result?.text || ''),
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
    console.error('[鎽勫儚澶存棩蹇梋 鍐欏叆澶辫触:', e.message);
  }
}

// ==========================================
// 瑙嗛褰曞埗绠＄悊
// ==========================================
const VIDEO_RECORD_DIR = resolveInside(PROJECT_ROOT, safeName(process.env.RECORDINGS_DIR || 'recordings', 'recordings'));
const RECORD_FPS = 15;                 // 褰曞埗甯х巼
const RECORD_SEGMENT_MIN = 10;         // 姣?10 鍒嗛挓鍒嗘涓€涓枃浠?const RECORD_MIN_INTERVAL_MS = 1000 / RECORD_FPS; // 鍐欏叆甯ф渶灏忛棿闅?
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
  // 濡傛灉宸插湪褰曞埗锛屽厛鍋滄鏃х殑
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
    // MKV 鏄祦寮忓鍣紝涓嶉渶瑕?movflags锛岃繘绋嬭 kill 涔熻兘姝ｅ父鎾斁
    filePath
  ];

  const proc = spawn(FFMPEG_PATH, args, {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true
  });

  proc.on('error', (err) => {
    console.error(`[褰曞埗:${recordingCamId}] FFmpeg 鍚姩澶辫触:`, err.message);
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[褰曞埗:${recordingCamId}] FFmpeg 寮傚父閫€鍑?code=${code}`);
    }
  });

  const recorder = {
    process: proc,
    filePath,
    startTime: Date.now(),
    lastWriteTime: 0
  };
  videoRecorders.set(recordingCamId, recorder);
  console.log(`[褰曞埗:${recordingCamId}] 寮€濮嬪綍鍒?-> ${filePath}`);
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

  // 缁?FFmpeg 鏈€澶?10 绉掕嚜鐒跺畬鎴愮紪鐮佸拰鍐欏叆 moov锛屼笉瑕佹彁鍓?kill
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

  console.log(`[褰曞埗:${recordingCamId}] 鍋滄褰曞埗`);
}

function writeVideoFrame(camId, jpegBuffer) {
  const recordingCamId = getRecordingCamId(camId);
  let recorder = videoRecorders.get(recordingCamId);

  if (!recorder) {
    return false;
  }

  if (!recorder.process || recorder.process.killed) return false;

  // 甯х巼鎺у埗
  const now = Date.now();
  if (now - recorder.lastWriteTime < RECORD_MIN_INTERVAL_MS) return false;
  recorder.lastWriteTime = now;

  // 鍐欏叆甯э紝澶勭悊 backpressure
  if (recorder.process.stdin.writableEnded || recorder.process.stdin.destroyed) return false;
  const ok = recorder.process.stdin.write(jpegBuffer);
  if (!ok) {
    // 缂撳啿鍖烘弧锛岀瓑 drain 鍚庡啀鎭㈠锛屼絾杩欓噷鐩存帴璺宠繃鏈抚鍗冲彲
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

function getDetectionConfig() {
  return readDetectionConfig({ env: process.env });
}

function getSkillConfigContext() {
  return buildSkillConfigContext(getDetectionConfig());
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
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
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
// 瑙嗛甯у鐞?(WebRTC)
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
// ==========================================
// AI 瀹氭椂鍒嗘瀽
// ==========================================
setInterval(async () => {
  const frameJpeg = getLatestFrameJpeg();
  if (!frameJpeg || isAnalyzing) return;

  isAnalyzing = true;
  const frameCopy = Buffer.from(frameJpeg);
  const startTime = Date.now();

  // Mark the current analysis pass as running.
  aiResult = {
    ...aiResult,
    analyzing: true,
    text: '姝ｅ湪鍒嗘瀽褰撳墠鐢婚潰...',
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  };
  broadcastSSE(aiResult);

  try {
    const base64 = frameCopy.toString('base64');

    // Bound analysis latency so one slow skill does not block the UI.
    const ANALYZE_TIMEOUT = 5000;
    const activeCam = getActiveCamera();
    const skillConfigContext = getSkillConfigContext();
    const analysisContext = {
      type: 'analyze',
      cameraId: activeCameraId,
      cameraLabel: activeCam ? (activeCam.label || maskCameraUrl(activeCam.url) || activeCameraId) : activeCameraId,
      timestamp: Date.now(),
      ...skillConfigContext
    };
    const result = await Promise.race([
      skillManager.analyzeAll(base64, analysisContext),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timed out after 5 seconds')), ANALYZE_TIMEOUT)
      )
    ]);

    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);

    aiResult = {
      text: result.text,
      time: timeStr,
      analyzing: false,
      alert: result.alert,
      alert_message: result.alert ? `妫€娴嬪埌瀹夊叏椋庨櫓: ${result.alert_details.join('; ')}` : '',
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
    writeCameraJsonLog(activeCameraId, result);
    broadcastSSE(aiResult);

    console.log(`[AI鍒嗘瀽鎴愬姛] ${timeStr}, 鑰楁椂 ${Date.now() - startTime}ms`);
  } catch (e) {
    const errMsg = `鍒嗘瀽寮傚父: ${e.message}`;
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    aiResult = {
      ...aiResult,
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
    writeCameraJsonLog(activeCameraId, { text: errMsg, alert: false, alert_details: [], risk_level: 'none', _skillResults: [] });
    broadcastSSE(aiResult);
    console.error('[AI鍒嗘瀽寮傚父]', e.message);
  } finally {
    isAnalyzing = false;
  }
}, ANALYSIS_INTERVAL * 1000);

// ==========================================
// Express 搴旂敤
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

// CORS锛氭敮鎸?nginx 鐙珛閮ㄧ讲鐨勫墠绔法鍩熻闂?// 濡傞渶闄愬埗鐗瑰畾鍩熷悕锛岃缃幆澧冨彉閲?CORS_ORIGIN=https://your-nginx-domain.com
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

// WebRTC 淇′护
app.post('/offer', async (req, res) => {
  try {
    webrtcInstanceId++;
    const camId = `webrtc-${webrtcInstanceId}`;
    console.log(`[淇′护] 鏀跺埌鍓嶇 offer #${webrtcInstanceId}, 鍒嗛厤鎽勫儚澶? ${camId}`);
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
    console.log(`[淇′护] 宸叉敞鍐屾憚鍍忓ご: ${camId}`);

    pc.addEventListener('connectionstatechange', () => {
      console.log(`[WebRTC:${camId}] 杩炴帴鐘舵€?`, pc.connectionState);
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
      console.log(`[WebRTC:${camId}] ICE 鏀堕泦鐘舵€?`, pc.iceGatheringState);
    });

    pc.addEventListener('track', (event) => {
      console.log(`[WebRTC:${camId}] track 浜嬩欢, kind:`, event.track.kind);
      if (event.track.kind === 'video') {
        console.log(`[WebRTC:${camId}] video track connected`);
        processVideoTrack(event.track, pc, camId).catch(console.error);
      }
    });

    await pc.setRemoteDescription(offer);
    console.log('[淇′护] setRemoteDescription 鎴愬姛');

    const answer = await pc.createAnswer();
    console.log('[淇′护] createAnswer 鎴愬姛');

    await pc.setLocalDescription(answer);
    console.log('[淇′护] setLocalDescription 鎴愬姛, ICE 鐘舵€?', pc.iceGatheringState);

    // 绛夊緟 ICE gathering 瀹屾垚锛岀‘淇?answer 鍖呭惈瀹屾暣鐨?candidates
    if (pc.iceGatheringState !== 'complete') {
      console.log('[淇′护] 绛夊緟 ICE candidates 鏀堕泦...');
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

        // 5 绉掑厹搴曪細鍗充娇娌℃敹鍒?complete锛屼篃杩斿洖宸叉湁 candidates
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            pc.removeEventListener('icegatheringstatechange', onIceComplete);
            console.log('[淇′护] ICE 鏀堕泦瓒呮椂锛屼娇鐢ㄥ凡鏀堕泦 candidates');
            resolve();
          }
        }, 5000);
      });
    }

    console.log('[淇′护] 杩斿洖 answer, candidates 宸插寘鍚?', pc.localDescription.sdp.includes('candidate'));

    res.json({
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type
    });
  } catch (e) {
    console.error('[淇′护] 閿欒:', e.message);
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

// 鑾峰彇 AI 鍒嗘瀽缁撴灉
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

// 娴嬭瘯椤甸潰锛氫笂浼犲浘鐗囧尯鍩熻繘琛?AI 鍒嗘瀽
app.post('/api/test-analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: '缂哄皯 imageBase64 鍙傛暟' });
    }

    console.log('[娴嬭瘯鍒嗘瀽] 鏀跺埌鍥剧墖锛屽紑濮嬭皟鐢?AI 鎶€鑳?..');
    const startTime = Date.now();
    const result = await skillManager.analyzeAll(imageBase64, {
      type: 'analyze',
      cameraId: 'test',
      timestamp: Date.now(),
      ...getSkillConfigContext()
    });
    console.log(`[娴嬭瘯鍒嗘瀽] 瀹屾垚锛岃€楁椂 ${Date.now() - startTime}ms`);

    res.json(result);
  } catch (e) {
    console.error('[娴嬭瘯鍒嗘瀽] 閿欒:', e.message);
    res.status(500).json({ error: e.message, text: '鍒嗘瀽寮傚父: ' + e.message, alert: false, alert_details: [] });
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
// 澶氭憚鍍忓ご绠＄悊 API
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
// RTSP 鎷夋祦绠＄悊锛堟棫鐗堝吋瀹?- 鎿嶄綔鍥哄畾 camera 鎴?webrtc 鎽勫儚澶达級
// ==========================================

/**
 * 鏃х増鍏煎 - 鍚姩 RTSP 娴侊紙瑕嗙洊 webrtc 鎽勫儚澶翠负 rtsp 妯″紡锛? */
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
    cam.label = '鎵嬫満鎺ㄦ祦';
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

// RTSP API 璺敱锛堟棫鐗堝吋瀹癸級
app.post('/api/rtsp/start', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('rtsp://')) {
    return res.status(400).json({ error: 'Invalid RTSP URL. Must start with rtsp://' });
  }
  startRtspStream(url);
  res.json({ success: true, message: '姝ｅ湪杩炴帴 RTSP 娴?..', ...getRtspInfo() });
});

app.post('/api/rtsp/stop', (req, res) => {
  stopRtspStream();
  res.json({ success: true, message: 'RTSP 娴佸凡鏂紑', ...getRtspInfo() });
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
// 鎶€鑳界鐞?API (v2 - 澶氭妧鑳?+ 寮€鍏?+ 鏂囦欢鍔犺浇)
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

// 鍒囨崲鎶€鑳藉惎鐢?绂佺敤
app.post('/api/skills/toggle', (req, res) => {
  try {
    const { skill, enabled } = req.body;
    if (!skill) {
      return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '缂哄皯 enabled 鍙傛暟 (boolean)' });
    }
    const result = skillManager.toggleSkill(skill, enabled);
    res.json({
      success: true,
      skill: result,
      message: enabled ? `宸插惎鐢?${result.label}` : `宸茬鐢?${result.label}`
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
      return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' });
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

// ==========================================
// 褰曞埗绠＄悊 API
// ==========================================

// 鎵弿褰曞埗鐩綍锛岃繑鍥炴墍鏈夋憚鍍忓ご锛堝惈褰曞埗鏂囦欢涓庣姸鎬侊級
function getRecordingList() {
  const result = [];
  const allCamIds = new Set();

  // 1. 鏀堕泦鎵€鏈夊凡鐭ユ憚鍍忓ご
  for (const [id, cam] of cameras) {
    allCamIds.add(id);
  }
  // 2. 鏀堕泦鏈夊綍鍒舵枃浠剁殑鎽勫儚澶达紙鍗充娇宸插垹闄わ級
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

// 鍋滄褰曞埗
app.post('/api/recordings/:id/stop', (req, res) => {
  const id = getRecordingCamId(req.params.id);
  stopVideoRecording(id);
  res.json({ success: true, cameraId: id, isRecording: false });
});

// 鍒犻櫎褰曞埗鏂囦欢
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

// 鎻愪緵褰曞埗鏂囦欢涓嬭浇/鎾斁锛堢洿鎺ヨ鍙栨枃浠讹級
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

// 鐩戝惉鏉ヨ嚜 Electron 涓昏繘绋嬬殑 IPC 娑堟伅锛堝綋閫氳繃 fork 鍚姩鏃讹級
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








