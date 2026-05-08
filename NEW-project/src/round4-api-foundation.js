const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DETECTION_CONFIG_PATH = path.join(DATA_DIR, 'detection-config.json');
const ALERTS_DB_PATH = path.join(DATA_DIR, 'alerts.db');
const SNAPSHOT_ROOT = path.join(DATA_DIR, 'snapshots');
const ALERT_HELPER_PATH = path.join(PROJECT_ROOT, 'scripts', 'query-alerts.py');

const DETECTION_LABELS = ['helmet', 'vest', 'no-helmet', 'no-vest', 'fire', 'smoke'];
const ALERT_LABELS = ['no-helmet', 'no-vest', 'fire', 'smoke'];
const MODEL_PROFILE_NAMES = ['default', 'ppe', 'fire'];
const WRITABLE_CONFIG_FIELDS = [
  'thresholds',
  'confirmFrames',
  'cooldowns',
  'modelProfile',
  'qwenReview',
  'analysisIntervalMs'
];

const MODEL_PROFILES = {
  default: { label: '默认模型', env: 'CYPHER_YOLO_MODEL' },
  ppe: { label: '安全帽/反光衣', env: 'CYPHER_YOLO_PPE_MODEL' },
  fire: { label: '火灾/烟雾', env: 'CYPHER_YOLO_FIRE_MODEL' }
};

const DEFAULT_DETECTION_CONFIG = {
  thresholds: {
    helmet: 0.35,
    vest: 0.35,
    'no-helmet': 0.55,
    'no-vest': 0.55,
    fire: 0.50,
    smoke: 0.50
  },
  confirmFrames: {
    'no-helmet': 3,
    'no-vest': 3,
    fire: 2,
    smoke: 2
  },
  cooldowns: {
    'no-helmet': 5,
    'no-vest': 5,
    fire: 10,
    smoke: 10
  },
  modelProfile: 'default',
  qwenReview: false,
  analysisIntervalMs: 1000
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return target;
}

function envNumber(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envInteger(env, name, fallback) {
  const parsed = envNumber(env, name, fallback);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function envBoolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function buildDefaultDetectionConfig(env = process.env) {
  const config = clone(DEFAULT_DETECTION_CONFIG);
  const defaultThreshold = envNumber(env, 'CYPHER_YOLO_CONF_DEFAULT', config.thresholds.helmet);

  config.thresholds.helmet = defaultThreshold;
  config.thresholds.vest = defaultThreshold;
  config.thresholds['no-helmet'] = envNumber(env, 'CYPHER_YOLO_CONF_NO_HELMET', config.thresholds['no-helmet']);
  config.thresholds['no-vest'] = envNumber(env, 'CYPHER_YOLO_CONF_NO_VEST', config.thresholds['no-vest']);
  config.thresholds.fire = envNumber(env, 'CYPHER_YOLO_CONF_FIRE', config.thresholds.fire);
  config.thresholds.smoke = envNumber(env, 'CYPHER_YOLO_CONF_SMOKE', config.thresholds.smoke);

  config.confirmFrames['no-helmet'] = envInteger(env, 'CYPHER_ALERT_CONFIRM_NO_HELMET', config.confirmFrames['no-helmet']);
  config.confirmFrames['no-vest'] = envInteger(env, 'CYPHER_ALERT_CONFIRM_NO_VEST', config.confirmFrames['no-vest']);
  config.confirmFrames.fire = envInteger(env, 'CYPHER_ALERT_CONFIRM_FIRE', config.confirmFrames.fire);
  config.confirmFrames.smoke = envInteger(env, 'CYPHER_ALERT_CONFIRM_SMOKE', config.confirmFrames.smoke);

  const ppeCooldown = envNumber(env, 'CYPHER_ALERT_COOLDOWN_SECONDS', config.cooldowns['no-helmet']);
  const fireCooldown = envNumber(env, 'CYPHER_FIRE_ALERT_COOLDOWN_SECONDS', config.cooldowns.fire);
  config.cooldowns['no-helmet'] = ppeCooldown;
  config.cooldowns['no-vest'] = ppeCooldown;
  config.cooldowns.fire = fireCooldown;
  config.cooldowns.smoke = fireCooldown;
  config.qwenReview = envBoolean(env, 'CYPHER_ENABLE_QWEN_REVIEW', config.qwenReview);

  return sanitizeDetectionConfigForResponse(config);
}

function ensurePlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function validateDetectionConfig(input) {
  ensurePlainObject(input, 'Detection config');
  const normalized = {};
  for (const key of Object.keys(input)) {
    if (!WRITABLE_CONFIG_FIELDS.includes(key)) {
      throw new Error(`Unsupported detection config field: ${key}`);
    }
  }

  if (input.thresholds !== undefined) {
    ensurePlainObject(input.thresholds, 'thresholds');
    normalized.thresholds = {};
    for (const [key, value] of Object.entries(input.thresholds)) {
      if (!DETECTION_LABELS.includes(key)) throw new Error(`Invalid threshold ${key}`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error(`Invalid threshold ${key}`);
      }
      normalized.thresholds[key] = parsed;
    }
  }

  if (input.confirmFrames !== undefined) {
    ensurePlainObject(input.confirmFrames, 'confirmFrames');
    normalized.confirmFrames = {};
    for (const [key, value] of Object.entries(input.confirmFrames)) {
      if (!ALERT_LABELS.includes(key)) throw new Error(`Invalid confirmFrames ${key}`);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
        throw new Error(`Invalid confirmFrames ${key}`);
      }
      normalized.confirmFrames[key] = parsed;
    }
  }

  if (input.cooldowns !== undefined) {
    ensurePlainObject(input.cooldowns, 'cooldowns');
    normalized.cooldowns = {};
    for (const [key, value] of Object.entries(input.cooldowns)) {
      if (!ALERT_LABELS.includes(key)) throw new Error(`Invalid cooldown ${key}`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3600) {
        throw new Error(`Invalid cooldown ${key}`);
      }
      normalized.cooldowns[key] = parsed;
    }
  }

  if (input.modelProfile !== undefined) {
    if (!MODEL_PROFILE_NAMES.includes(input.modelProfile)) {
      throw new Error('Invalid modelProfile');
    }
    normalized.modelProfile = input.modelProfile;
  }

  if (input.qwenReview !== undefined) {
    if (typeof input.qwenReview !== 'boolean') {
      throw new Error('Invalid qwenReview');
    }
    normalized.qwenReview = input.qwenReview;
  }

  if (input.analysisIntervalMs !== undefined) {
    const parsed = Number(input.analysisIntervalMs);
    if (!Number.isInteger(parsed) || parsed < 500 || parsed > 10000) {
      throw new Error('Invalid analysisIntervalMs');
    }
    normalized.analysisIntervalMs = parsed;
  }

  return normalized;
}

function mergeDetectionConfig(base, override) {
  const config = sanitizeDetectionConfigForResponse(base);
  if (!override || Object.keys(override).length === 0) return config;
  const normalized = validateDetectionConfig(override);

  if (normalized.thresholds) {
    config.thresholds = { ...config.thresholds, ...normalized.thresholds };
  }
  if (normalized.confirmFrames) {
    config.confirmFrames = { ...config.confirmFrames, ...normalized.confirmFrames };
  }
  if (normalized.cooldowns) {
    config.cooldowns = { ...config.cooldowns, ...normalized.cooldowns };
  }
  for (const key of ['modelProfile', 'qwenReview', 'analysisIntervalMs']) {
    if (normalized[key] !== undefined) config[key] = normalized[key];
  }
  return sanitizeDetectionConfigForResponse(config);
}

function sanitizeDetectionConfigForResponse(config) {
  const result = clone({
    thresholds: config.thresholds,
    confirmFrames: config.confirmFrames,
    cooldowns: config.cooldowns,
    modelProfile: config.modelProfile,
    qwenReview: config.qwenReview,
    analysisIntervalMs: config.analysisIntervalMs
  });
  result.modelProfiles = clone(MODEL_PROFILES);
  return result;
}

function configWithoutReadOnlyFields(config) {
  return {
    thresholds: clone(config.thresholds),
    confirmFrames: clone(config.confirmFrames),
    cooldowns: clone(config.cooldowns),
    modelProfile: config.modelProfile,
    qwenReview: config.qwenReview,
    analysisIntervalMs: config.analysisIntervalMs
  };
}

function readDetectionConfig(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const env = options.env || process.env;
  const configPath = options.configPath || resolveInside(dataDir, 'detection-config.json');
  let config = buildDefaultDetectionConfig(env);
  if (!fs.existsSync(configPath)) return config;

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config = mergeDetectionConfig(config, parsed);
  return config;
}

function writeDetectionConfig(input, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const env = options.env || process.env;
  const configPath = options.configPath || resolveInside(dataDir, 'detection-config.json');
  const safePath = resolveInside(dataDir, path.basename(configPath));
  if (safePath !== path.resolve(configPath)) {
    throw new Error('Invalid detection config path');
  }
  const current = readDetectionConfig({ dataDir, env, configPath });
  const merged = mergeDetectionConfig(current, input);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(safePath, JSON.stringify(configWithoutReadOnlyFields(merged), null, 2) + '\n');
  return merged;
}

function buildSkillConfigContext(config) {
  const safeConfig = sanitizeDetectionConfigForResponse(config);
  const skillConfig = {
    thresholds: clone(safeConfig.thresholds),
    confirmFrames: clone(safeConfig.confirmFrames),
    confirmCounts: clone(safeConfig.confirmFrames),
    cooldowns: clone(safeConfig.cooldowns),
    modelProfile: safeConfig.modelProfile,
    qwenReview: safeConfig.qwenReview,
    analysisIntervalMs: safeConfig.analysisIntervalMs
  };
  return {
    config: skillConfig,
    detectionConfig: skillConfig,
    qwenReview: safeConfig.qwenReview,
    modelProfile: safeConfig.modelProfile
  };
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveAlertSnapshotPath(snapshotPath, options = {}) {
  if (!snapshotPath || typeof snapshotPath !== 'string') {
    throw new Error('Snapshot path is empty');
  }
  if (path.isAbsolute(snapshotPath)) {
    throw new Error('Absolute snapshot path is not allowed');
  }
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const snapshotRoot = path.resolve(options.snapshotRoot || SNAPSHOT_ROOT);
  const target = path.resolve(projectRoot, snapshotPath);
  if (target !== snapshotRoot && !target.startsWith(snapshotRoot + path.sep)) {
    throw new Error('Snapshot path traversal blocked');
  }
  const ext = path.extname(target).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    throw new Error('Unsupported snapshot file type');
  }
  return target;
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  DETECTION_CONFIG_PATH,
  ALERTS_DB_PATH,
  SNAPSHOT_ROOT,
  ALERT_HELPER_PATH,
  DEFAULT_DETECTION_CONFIG,
  MODEL_PROFILES,
  buildDefaultDetectionConfig,
  validateDetectionConfig,
  mergeDetectionConfig,
  readDetectionConfig,
  writeDetectionConfig,
  buildSkillConfigContext,
  parsePositiveInt,
  resolveAlertSnapshotPath,
  resolveInside,
  configWithoutReadOnlyFields
};
