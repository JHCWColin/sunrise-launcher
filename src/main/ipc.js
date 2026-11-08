'use strict';

const { ipcMain, dialog, shell, app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  APP_NAME,
  APP_NAME_EN,
  APP_TAGLINE,
  GITHUB_URL,
  IMAGE_EXTS,
  categoryOf,
  extOf,
} = require('./constants');
const store = require('./store');
const apps = require('./apps');
const log = require('./logger');

const CONFIG_KEYS = new Set([
  'theme', 'accent', 'glass', 'reduceMotion', 'skipIntro', 'developer',
  'clock24h', 'showSeconds', 'downloadsDir', 'autoOpen', 'autoOpenTypes',
  'videoPlayer', 'wpsPath', 'autoStart', 'preventSleep', 'showRecent',
]);

function sanitizePatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CONFIG_KEYS.has(key)) out[key] = value;
  }
  if (raw.nas && typeof raw.nas === 'object') {
    const nas = {};
    for (const key of ['host', 'port', 'https', 'allowSelfSigned', 'defaultPath', 'timeoutMs']) {
      if (Object.prototype.hasOwnProperty.call(raw.nas, key)) nas[key] = raw.nas[key];
    }
    out.nas = nas;
  }
  if (raw.autoOpenTypes && typeof raw.autoOpenTypes === 'object') {
    const types = {};
    for (const key of ['video', 'presentation', 'document', 'sheet', 'pdf', 'image', 'courseware', 'audio', 'other']) {
      if (Object.prototype.hasOwnProperty.call(raw.autoOpenTypes, key)) types[key] = Boolean(raw.autoOpenTypes[key]);
    }
    out.autoOpenTypes = types;
  }
  return out;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function validateNasPath(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.length > 1500) return null;
  if (value.includes('\u0000')) return null;
  return value;
}

function statePayload(ctx) {
  const config = store.get();
  const display = screen.getPrimaryDisplay();
  const login = (() => {
    try { return app.getLoginItemSettings(); } catch (_) { return { openAtLogin: false }; }
  })();
  return {
    app: {
      name: APP_NAME,
      nameEn: APP_NAME_EN,
      tagline: APP_TAGLINE,
      version: app.getVersion(),
      developer: config.developer,
      github: GITHUB_URL,
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    config,
    apps: apps.detect(config),
    nasStatus: ctx.getNasStatus(),
    autoStartEnabled: Boolean(login.openAtLogin),
    display: {
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
    },
    paths: {
      downloads: config.downloadsDir,
      userData: app.getPath('userData'),
      logs: log.logDir(),
      config: store.configPath(),
    },
    startedAt: Date.now(),
  };
}

function registerIpc(ctx) {
  const { nas, downloader, watcher, send } = ctx;

  ipcMain.handle('app:get-state', async () => statePayload(ctx));

  ipcMain.handle('config:update', async (event, rawPatch) => {
    const previous = store.get();
    const patch = sanitizePatch(rawPatch);
    if (!patch) return { ok: false, message: '无效的设置内容' };
    if (patch.downloadsDir) {
      const dir = String(patch.downloadsDir);
      if (!path.isAbsolute(dir)) return { ok: false, message: '下载目录必须是绝对路径' };
      try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, `.sunrise-write-test-${Date.now()}`);
        fs.writeFileSync(probe, 'ok');
        fs.rmSync(probe, { force: true });
      } catch (err) {
        return { ok: false, message: `下载目录不可写：${err.message}` };
      }
    }
    const next = store.update(patch);
    ctx.applyConfigEffects(next, previous);
    return { ok: true, config: next, apps: apps.detect(next) };
  });

  ipcMain.handle('config:reset', async () => {
    const previous = store.get();
    const next = store.reset();
    ctx.applyConfigEffects(next, previous);
    return { ok: true, config: next, apps: apps.detect(next) };
  });

  ipcMain.handle('app:set-auto-start', async (event, enabled) => {
    const previous = store.get();
    const next = store.update({ autoStart: Boolean(enabled) });
    ctx.applyConfigEffects(next, previous);
    return { ok: true, config: next };
  });

  ipcMain.handle('launch:app', async (event, key) => {
    if (!['wps', 'board', 'camera'].includes(key)) {
      return { ok: false, message: '未知的启动项' };
    }
    const result = await apps.launchApp(key, store.get());
    return result;
  });

  ipcMain.handle('launch:file', async (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false, message: '无效的文件路径' };
    }
    const config = store.get();
    const result = await apps.openFile(filePath, config);
    if (result.ok && result.mode === 'internal-image') {
      send('viewer:open', {
        path: filePath,
        name: path.basename(filePath),
        size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
        source: 'recent',
      });
      return { ok: true, mode: 'internal-image' };
    }
    return result;
  });

  ipcMain.handle('nas:list', async (event, rawPath) => {
    const target = validateNasPath(rawPath);
    if (!target) return { ok: false, message: '无效的课件路径', code: 'BAD_PATH' };
    try {
      const listing = await nas.list(target);
      ctx.setNasStatus({
        connected: true,
        state: 'online',
        message: '课件库已连接',
        path: listing.path,
        itemCount: listing.total,
      });
      return { ok: true, ...listing };
    } catch (err) {
      log.warn('列目录失败:', target, err.message);
      if (err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'DOWNLOAD_502') {
        ctx.setNasStatus({ connected: false, state: 'offline', message: err.message, code: err.code });
      }
      return { ok: false, message: err.message || '读取目录失败', code: err.code || 'LIST_FAILED' };
    }
  });

  ipcMain.handle('nas:download', async (event, payload) => {
    if (!payload || typeof payload !== 'object') return { ok: false, message: '无效的下载请求' };
    const nasPath = validateNasPath(payload.path);
    if (!nasPath || nasPath === '/') return { ok: false, message: '无效的文件路径' };
    const name = typeof payload.name === 'string' && payload.name
      ? payload.name
      : path.basename(nasPath);
    try {
      const result = await downloader.enqueue(nasPath, name, payload.size);
      return result;
    } catch (err) {
      return { ok: false, message: err.message || '下载失败' };
    }
  });

  ipcMain.handle('nas:test', async () => {
    ctx.setNasStatus({ state: 'checking', message: '正在测试连接…' });
    try {
      const result = await nas.testConnection();
      ctx.setNasStatus({
        connected: true,
        state: 'online',
        message: '课件库已连接',
        latency: result.latency,
    });
      return { ok: true, ...result };
    } catch (err) {
      ctx.setNasStatus({ connected: false, state: 'offline', message: err.message, code: err.code || '' });
      return { ok: false, message: err.message || '连接失败', code: err.code || '' };
    }
  });

  ipcMain.handle('nas:status', async (event, refresh) => {
    if (refresh) return ctx.checkNasStatus('manual');
    return ctx.getNasStatus();
  });

  ipcMain.handle('downloads:open-folder', async () => {
    const dir = store.ensureDownloadDir(store.get());
    const error = await shell.openPath(dir);
    return error ? { ok: false, message: error } : { ok: true };
  });

  ipcMain.handle('downloads:choose-folder', async () => {
    const win = ctx.getWindow();
    const config = store.get();
    const result = await dialog.showOpenDialog(win, {
      title: '选择课件下载文件夹',
      defaultPath: config.downloadsDir,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '使用此文件夹',
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const dir = result.filePaths[0];
    const previous = store.get();
    const next = store.update({ downloadsDir: dir });
    ctx.applyConfigEffects(next, previous);
    if (watcher) watcher.restart();
    return { ok: true, config: next };
  });

  ipcMain.handle('downloads:open-file', async (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, message: '无效的文件路径' };
    return ctx.openDownloaded(filePath, 'recent', true);
  });

  ipcMain.handle('downloads:reveal', async (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, message: '无效的文件路径' };
    return apps.reveal(filePath);
  });

  ipcMain.handle('recent:list', async () => store.get().recent);
  ipcMain.handle('recent:remove', async (event, filePath) => {
    if (typeof filePath === 'string') store.removeRecent(filePath);
    const recent = store.get().recent;
    send('recent:updated', recent);
    return recent;
  });

  ipcMain.handle('media:read-image', async (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, message: '无效的文件路径' };
    const ext = extOf(filePath);
    if (!IMAGE_EXTS.includes(ext)) return { ok: false, message: '这不是可预览的图片格式' };
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) { return { ok: false, message: '图片不存在' }; }
    if (!stat.isFile()) return { ok: false, message: '图片不存在' };
    if (stat.size > 80 * 1024 * 1024) return { ok: false, message: '图片过大，已改用系统应用打开' };

    const config = store.get();
    const allowed = isInside(config.downloadsDir, filePath)
      || config.recent.some((r) => r.path === filePath);
    if (!allowed) return { ok: false, message: '只能预览下载目录中的图片' };

    try {
      const buf = await fs.promises.readFile(filePath);
      const mime = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
        tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
      }[ext] || 'application/octet-stream';
      return {
        ok: true,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        name: path.basename(filePath),
        size: stat.size,
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('app:open-external', async (event, url) => apps.openExternal(url));
  ipcMain.handle('app:open-logs', async () => {
    const error = await shell.openPath(log.logDir());
    return error ? { ok: false, message: error } : { ok: true };
  });
  ipcMain.handle('app:open-config-folder', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    return error ? { ok: false, message: error } : { ok: true };
  });
  ipcMain.handle('app:focus', async () => {
    const win = ctx.getWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('app:diagnostics', async () => {
    const config = store.get();
    const info = apps.detect(config);
    const display = screen.getPrimaryDisplay();
    const lines = [
      `${APP_NAME} v${app.getVersion()}`,
      `Electron ${process.versions.electron} / Chrome ${process.versions.chrome} / Node ${process.versions.node}`,
      `Windows ${process.getSystemVersion ? process.getSystemVersion() : ''} (${process.arch})`,
      `打包: ${app.isPackaged}  开发窗口: ${process.env.SUNRISE_DEV_WINDOW === '1'}`,
      `屏幕: ${display.size.width}×${display.size.height} @ ${display.scaleFactor}x`,
      `用户数据: ${app.getPath('userData')}`,
      `配置文件: ${store.configPath()}`,
      `下载目录: ${config.downloadsDir}`,
      `NAS: ${config.nas.https ? 'https' : 'http'}://${config.nas.host}:${config.nas.port}${config.nas.defaultPath}`,
      `NAS 状态: ${ctx.getNasStatus().state} / ${ctx.getNasStatus().message}`,
      `WPS: ${info.wps.available ? info.wps.path : '未找到'}`,
      `希沃白板: ${info.board.available ? info.board.path : '未找到'}`,
      `视频展台: ${info.camera.available ? info.camera.path : '未找到'}`,
      `VLC: ${info.vlc.available ? info.vlc.path : '未找到'}`,
      `PotPlayer: ${info.potplayer.available ? info.potplayer.path : '未找到'}`,
      `主题: ${config.theme}  玻璃: ${config.glass}  降低动效: ${config.reduceMotion}`,
    ];
    return { ok: true, text: lines.join('\r\n') };
  });

  ipcMain.handle('app:quit', async () => {
    setTimeout(() => { ctx.requestQuit(); }, 60);
    return { ok: true };
  });

  ipcMain.handle('log:renderer', async (event, level, message) => {
    const text = String(message || '').slice(0, 2000);
    if (level === 'error') log.error('[renderer]', text);
    else if (level === 'warn') log.warn('[renderer]', text);
    else log.info('[renderer]', text);
    return { ok: true };
  });

  ipcMain.handle('app:clipboard-write', async (event, text) => {
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(String(text || ''));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
}

module.exports = { registerIpc };
