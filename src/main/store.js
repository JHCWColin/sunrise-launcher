'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { NAS_DEFAULTS } = require('./constants');
const log = require('./logger');

let configPath = '';
let cache = null;
let persisted = null;
let saveTimer = null;

function defaultConfig() {
  return {
    version: 1,
    theme: 'dark',
    accent: 'sunrise',
    glass: 1,
    glow: 0.3,
    bgDim: 0.55,
    background: '',
    reduceMotion: false,
    skipIntro: false,
    clock24h: true,
    showSeconds: false,
    nas: {
      host: NAS_DEFAULTS.host,
      port: NAS_DEFAULTS.port,
      https: NAS_DEFAULTS.https,
      allowSelfSigned: NAS_DEFAULTS.allowSelfSigned,
      defaultPath: NAS_DEFAULTS.defaultPath,
      timeoutMs: NAS_DEFAULTS.timeoutMs,
    },
    downloadsDir: '',
    autoOpen: true,
    autoOpenTypes: {
      video: true,
      presentation: true,
      document: true,
      sheet: true,
      pdf: true,
      image: true,
      courseware: true,
      audio: true,
      other: false,
    },
    videoPlayer: 'auto',
    wpsPath: '',
    recent: [],
    autoStart: false,
    preventSleep: true,
    showRecent: true,
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizePathString(value, fallback) {
  if (typeof value !== 'string') return fallback;
  let p = value.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  if (!p) return fallback;
  return p;
}

const BACKGROUND_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

function normalizeBackground(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate) return '';
  if (!BACKGROUND_EXTS.includes(path.extname(candidate).toLowerCase())) return '';
  try {
    return fs.statSync(candidate).isFile() ? candidate : '';
  } catch (_) {
    return '';
  }
}

function sanitizeRecent(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const filePath = typeof item.path === 'string' ? item.path : '';
    if (!filePath || seen.has(filePath)) continue;
    if (!fs.existsSync(filePath)) continue;
    seen.add(filePath);
    let size = Number(item.size) || 0;
    if (!size) {
      try { size = fs.statSync(filePath).size; } catch (_) { /* ignore */ }
    }
    out.push({
      path: filePath,
      name: typeof item.name === 'string' && item.name ? item.name : path.basename(filePath),
      ext: typeof item.ext === 'string' ? item.ext : path.extname(filePath).replace('.', '').toLowerCase(),
      size,
      at: Number(item.at) || Date.now(),
      source: item.source === 'nas' ? 'nas' : 'local',
    });
    if (out.length >= 10) break;
  }
  return out;
}

function normalize(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') raw = {};
  const nas = raw.nas && typeof raw.nas === 'object' ? raw.nas : {};

  const merged = {
    ...base,
    ...raw,
    nas: {
      ...base.nas,
      ...nas,
    },
    autoOpenTypes: {
      ...base.autoOpenTypes,
      ...(raw.autoOpenTypes && typeof raw.autoOpenTypes === 'object' ? raw.autoOpenTypes : {}),
    },
  };

  merged.theme = merged.theme === 'light' ? 'light' : 'dark';
  merged.accent = ['sunrise', 'ocean', 'violet', 'emerald'].includes(merged.accent) ? merged.accent : 'sunrise';
  merged.glass = clampNumber(merged.glass, 0.35, 1.6, 1);
  merged.glow = clampNumber(merged.glow, 0, 1.5, 0.3);
  merged.bgDim = clampNumber(merged.bgDim, 0, 0.9, 0.55);
  merged.background = normalizeBackground(merged.background);
  merged.reduceMotion = Boolean(merged.reduceMotion);
  merged.skipIntro = Boolean(merged.skipIntro);
  merged.clock24h = Boolean(merged.clock24h);
  merged.showSeconds = Boolean(merged.showSeconds);
  merged.autoOpen = Boolean(merged.autoOpen);
  merged.autoStart = Boolean(merged.autoStart);
  merged.preventSleep = merged.preventSleep !== false;
  merged.showRecent = merged.showRecent !== false;
  // 开发者署名已固定，旧配置里的自定义署名不再生效。
  delete merged.developer;

  merged.nas.host = typeof merged.nas.host === 'string' && merged.nas.host.trim()
    ? merged.nas.host.trim().slice(0, 120)
    : NAS_DEFAULTS.host;
  merged.nas.port = Math.round(clampNumber(merged.nas.port, 1, 65535, NAS_DEFAULTS.port));
  merged.nas.https = Boolean(merged.nas.https);
  merged.nas.allowSelfSigned = merged.nas.allowSelfSigned !== false;
  merged.nas.defaultPath = typeof merged.nas.defaultPath === 'string' && merged.nas.defaultPath.startsWith('/')
    ? merged.nas.defaultPath.replace(/\/+$/, '') || '/'
    : NAS_DEFAULTS.defaultPath;
  merged.nas.timeoutMs = Math.round(clampNumber(merged.nas.timeoutMs, 3000, 120000, NAS_DEFAULTS.timeoutMs));

  merged.videoPlayer = ['auto', 'vlc', 'potplayer', 'system'].includes(merged.videoPlayer)
    ? merged.videoPlayer
    : 'auto';
  merged.wpsPath = typeof merged.wpsPath === 'string' ? merged.wpsPath.trim() : '';
  merged.downloadsDir = normalizePathString(merged.downloadsDir, app.getPath('downloads'));
  merged.recent = sanitizeRecent(merged.recent);

  for (const key of Object.keys(merged.autoOpenTypes)) {
    merged.autoOpenTypes[key] = Boolean(merged.autoOpenTypes[key]);
  }

  return merged;
}

function envOverrides(cfg) {
  if (process.env.SUNRISE_NAS_HOST) cfg.nas.host = process.env.SUNRISE_NAS_HOST;
  if (process.env.SUNRISE_NAS_PORT) cfg.nas.port = Number(process.env.SUNRISE_NAS_PORT) || cfg.nas.port;
  if (process.env.SUNRISE_NAS_HTTPS !== undefined) cfg.nas.https = process.env.SUNRISE_NAS_HTTPS !== '0';
  if (process.env.SUNRISE_NAS_ALLOW_SELF_SIGNED !== undefined) {
    cfg.nas.allowSelfSigned = process.env.SUNRISE_NAS_ALLOW_SELF_SIGNED !== '0';
  }
  if (process.env.SUNRISE_DOWNLOADS_DIR) cfg.downloadsDir = process.env.SUNRISE_DOWNLOADS_DIR;
  if (process.env.SUNRISE_THEME) cfg.theme = process.env.SUNRISE_THEME;
  if (process.env.SUNRISE_SKIP_INTRO === '1') cfg.skipIntro = true;
  if (process.env.SUNRISE_AUTO_OPEN === '0') cfg.autoOpen = false;
  return cfg;
}

function init() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  let raw = null;
  try {
    if (fs.existsSync(configPath)) {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    }
  } catch (err) {
    log.warn('读取配置失败，使用默认配置:', err.message);
  }
  persisted = normalize(raw);
  ensureDownloadDir(persisted);
  ensureUserDataDirs();
  saveNow();
  // 环境变量只影响本次运行，不写回配置文件（避免开发调试参数被永久保存）。
  cache = envOverrides(structuredClone(persisted));
  ensureDownloadDir(cache);
  log.info('配置已加载:', configPath);
  return cache;
}

function ensureUserDataDirs() {
  const userData = app.getPath('userData');
  for (const sub of ['logs', 'cache', 'covers']) {
    try { fs.mkdirSync(path.join(userData, sub), { recursive: true }); } catch (_) { /* ignore */ }
  }
}

function ensureDownloadDir(cfg) {
  const dir = cfg.downloadsDir || app.getPath('downloads');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    log.warn('创建下载目录失败，回退系统下载目录:', dir, err.message);
    cfg.downloadsDir = app.getPath('downloads');
    try { fs.mkdirSync(cfg.downloadsDir, { recursive: true }); } catch (_) { /* ignore */ }
  }
  return cfg.downloadsDir;
}

function get() {
  if (!cache) init();
  return cache;
}

function saveNow() {
  if (!persisted || !configPath) return;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8');
    fs.renameSync(tmp, configPath);
  } catch (err) {
    log.error('保存配置失败:', err.message);
  }
}

function saveDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 180);
}

function update(patch) {
  if (!cache) init();
  if (!patch || typeof patch !== 'object') return cache;
  const base = persisted || defaultConfig();
  const nextRaw = {
    ...base,
    ...patch,
    nas: patch.nas && typeof patch.nas === 'object' ? { ...base.nas, ...patch.nas } : base.nas,
    autoOpenTypes: patch.autoOpenTypes && typeof patch.autoOpenTypes === 'object'
      ? { ...base.autoOpenTypes, ...patch.autoOpenTypes }
      : base.autoOpenTypes,
  };
  persisted = normalize(nextRaw);
  ensureDownloadDir(persisted);
  saveDebounced();
  cache = envOverrides(structuredClone(persisted));
  ensureDownloadDir(cache);
  return cache;
}

function reset() {
  persisted = defaultConfig();
  ensureDownloadDir(persisted);
  saveNow();
  cache = envOverrides(structuredClone(persisted));
  ensureDownloadDir(cache);
  return cache;
}

function addRecent(filePath, source = 'nas') {
  if (!cache) init();
  if (!filePath) return cache.recent;
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch (_) { /* ignore */ }
  const item = {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).replace('.', '').toLowerCase(),
    size,
    at: Date.now(),
    source,
  };
  const base = persisted || cache;
  const existing = base.recent.filter((r) => r.path !== filePath);
  const next = [item, ...existing].slice(0, 8);
  base.recent = next;
  cache.recent = next;
  saveDebounced();
  return next;
}

function removeRecent(filePath) {
  if (!cache) return [];
  const next = cache.recent.filter((r) => r.path !== filePath);
  cache.recent = next;
  if (persisted) persisted.recent = next;
  saveDebounced();
  return next;
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

module.exports = {
  init,
  get,
  update,
  reset,
  addRecent,
  removeRecent,
  flush,
  ensureDownloadDir,
  configPath: () => configPath,
  defaults: defaultConfig,
};
