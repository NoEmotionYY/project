/**
 * Node.js 核心服务
 * 职责: WebRTC 收流、RTSP 拉流、抽帧、AI 技能调用、SSE 推送、HTTPS API
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
// 加载 AI 技能（通过技能管理器）// ==========================================
const skillManager = requireProjectModule('skill-manager');
let aiSkill; // 向后兼容，保留引用
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
// 全局状态// ==========================================
let isAnalyzing = false;
let activeCameraId = 'webrtc';  // current active camera
let cameraIdCounter = 0;

let aiResult = {
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

const RTSP_WIDTH = 1280;
const RTSP_HEIGHT = 720;
const RTSP_FPS = 10;

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

// ==========================================
// 视频录制管理
// ==========================================
const VIDEO_RECORD_DIR = resolveInside(PROJECT_ROOT, safeName(process.env.RECORDINGS_DIR || 'recordings', 'recordings'));
const RECORD_FPS = 15;                 // 录制帧率
const RECORD_SEGMENT_MIN = 10;         // 每 10 分钟分段一个文件const RECORD_MIN_INTERVAL_MS = 1000 / RECORD_FPS; // 写入帧最小间隔
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
// ==========================================
// AI 定时分析
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
    text: '正在分析当前画面...',
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
      alert_message: result.alert ? `检测到安全风险: ${result.alert_details.join('; ')}` : '',
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

    console.log(`[AI分析成功] ${timeStr}, 耗时 ${Date.now() - startTime}ms`);
  } catch (e) {
    const errMsg = `分析异常: ${e.message}`;
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
    console.error('[AI分析异常]', e.message);
  } finally {
    isAnalyzing = false;
  }
}, ANALYSIS_INTERVAL * 1000);

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
      console.log(`[WebRTC:${camId}] track 浜嬩欢, kind:`, event.track.kind);
      if (event.track.kind === 'video') {
        console.log(`[WebRTC:${camId}] video track connected`);
        processVideoTrack(event.track, pc, camId).catch(console.error);
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








