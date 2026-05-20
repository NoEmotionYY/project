/**
 * WebRTC 音频检测技能
 * 依赖 server.js 通过 RTCAudioSink 写入 context.audio / context.audioMetrics。
 * 不处理原始音频流，只根据 dBFS / 峰值等轻量指标做响声告警治理。
 */
const skillMeta = {
  name: 'audio-detector',
  label: '音频异常检测',
  description: '检测 WebRTC 麦克风音轨中的异常响声，支持阈值、连续确认和冷却。'
};
const { name, label, description } = skillMeta;

const state = new Map();

function nowMs() {
  return Date.now();
}

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function getAudioConfig(context = {}) {
  const raw = context.detectionConfig?.audio || context.config?.audio || context.audioConfig || {};
  return {
    enabled: boolValue(raw.enabled, true),
    loudDbfs: Math.max(-90, Math.min(0, numberValue(raw.loudDbfs, -18))),
    confirmFrames: Math.max(1, Math.min(20, Math.floor(numberValue(raw.confirmFrames, 3)))),
    cooldownSeconds: Math.max(0, Math.min(3600, numberValue(raw.cooldownSeconds, 8))),
    staleMs: Math.max(500, Math.min(60000, Math.floor(numberValue(raw.staleMs, 3000))))
  };
}

function getAudioMetrics(context = {}) {
  return context.audioMetrics || context.audio || null;
}

function getCameraState(cameraId) {
  const key = String(cameraId || 'active');
  if (!state.has(key)) {
    state.set(key, {
      loudCount: 0,
      lastAlertAt: 0
    });
  }
  return state.get(key);
}

function buildBaseResult(text, extra = {}) {
  return {
    success: true,
    skill: name,
    text,
    alert: false,
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
    detections: [],
    meta: {},
    ...extra
  };
}

async function analyze(_base64Image, context = {}) {
  const config = getAudioConfig(context);
  const cameraId = context.cameraId || 'active';
  const cameraLabel = context.cameraLabel || cameraId;
  const audio = getAudioMetrics(context);

  if (!config.enabled) {
    return buildBaseResult('音频检测已关闭', {
      meta: { audioEnabled: false }
    });
  }

  if (!audio) {
    return buildBaseResult('音频检测：未收到音频指标', {
      meta: { audioEnabled: true, reason: 'missing-audio-metrics' }
    });
  }

  const ageMs = numberValue(audio.ageMs, nowMs() - numberValue(audio.lastAt, nowMs()));
  if (ageMs > config.staleMs) {
    const st = getCameraState(cameraId);
    st.loudCount = 0;
    return buildBaseResult(`音频检测：音频数据已过期 ${Math.round(ageMs)}ms`, {
      meta: { audioEnabled: true, stale: true, ageMs }
    });
  }

  const levelDbfs = numberValue(audio.windowPeakDbfs, numberValue(audio.peakDbfs, numberValue(audio.dbfs, -120)));
  const isLoud = levelDbfs >= config.loudDbfs;
  const st = getCameraState(cameraId);

  if (!isLoud) {
    st.loudCount = 0;
    return buildBaseResult(`音频检测：正常（峰值 ${levelDbfs.toFixed(1)} dBFS，阈值 ${config.loudDbfs} dBFS）`, {
      detections: [{
        label: 'audio-level',
        name: '音频强度',
        confidence: Math.max(0, Math.min(1, (levelDbfs + 90) / 90)),
        value: Number(levelDbfs.toFixed(2)),
        unit: 'dBFS',
        severity: 'info'
      }],
      meta: { audioEnabled: true, levelDbfs, thresholdDbfs: config.loudDbfs }
    });
  }

  st.loudCount += 1;
  const confirmed = st.loudCount >= config.confirmFrames;
  const cooled = nowMs() - st.lastAlertAt >= config.cooldownSeconds * 1000;

  const detection = {
    label: 'loud-audio',
    name: '异常响声',
    confidence: Math.max(0, Math.min(1, (levelDbfs - config.loudDbfs + 20) / 20)),
    value: Number(levelDbfs.toFixed(2)),
    unit: 'dBFS',
    severity: 'warning',
    count: st.loudCount,
    threshold: config.loudDbfs
  };

  if (!confirmed || !cooled) {
    return buildBaseResult(`音频检测：响声候选（${st.loudCount}/${config.confirmFrames}，${levelDbfs.toFixed(1)} dBFS）`, {
      detections: [detection],
      meta: {
        audioEnabled: true,
        candidate: true,
        confirmed,
        cooled,
        levelDbfs,
        thresholdDbfs: config.loudDbfs
      }
    });
  }

  st.lastAlertAt = nowMs();
  const message = `连续 ${config.confirmFrames} 次检测到异常响声（${levelDbfs.toFixed(1)} dBFS）`;
  const alert = {
    type: 'loud-audio',
    category: 'audio',
    categoryCn: '音频',
    title: '异常响声',
    severity: 'warning',
    confidence: detection.confidence,
    cameraId,
    cameraLabel,
    skillId: name,
    sourceSkill: name,
    message,
    count: st.loudCount,
    boxes: [],
    audio: {
      dbfs: audio.dbfs,
      peakDbfs: audio.peakDbfs,
      windowPeakDbfs: audio.windowPeakDbfs,
      level: audio.level,
      sampleRate: audio.sampleRate,
      channelCount: audio.channelCount
    },
    snapshotPath: '',
    videoPath: context.videoPath || '',
    eventId: null,
    confirmed: true,
    reviewedByQwen: false,
    needsReview: false,
    reviewReason: ''
  };

  return buildBaseResult(message, {
    alert: true,
    alert_details: ['异常响声'],
    voice_reminder: true,
    voice_text: '检测到异常响声，请注意现场情况',
    voice_texts: ['检测到异常响声，请注意现场情况'],
    risk_level: 'medium',
    beep_count: 2,
    alerts: [alert],
    detections: [detection],
    meta: {
      audioEnabled: true,
      levelDbfs,
      thresholdDbfs: config.loudDbfs,
      confirmFrames: config.confirmFrames,
      cooldownSeconds: config.cooldownSeconds
    }
  });
}

module.exports = {
  name: 'audio-detector',
  label: '音频异常检测',
  description: '检测 WebRTC 麦克风音轨中的异常响声，支持阈值、连续确认和冷却。',
  analyze
};
