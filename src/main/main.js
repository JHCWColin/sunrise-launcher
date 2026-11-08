'use strict';

const { app, BrowserWindow, Menu, protocol, shell, globalShortcut, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const { APP_ID, APP_NAME, categoryOf } = require('./constants');
const log = require('./logger');
const store = require('./store');
const taskbar = require('./taskbar');
const apps = require('./apps');
const { NasClient } = require('./nas');
const { DownloadManager, DownloadsWatcher, cleanupOldParts } = require('./downloads');
const { registerIpc } = require('./ipc');

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
const DEV_WINDOW = process.env.SUNRISE_DEV_WINDOW === '1';
const DEVTOOLS = process.env.SUNRISE_DEVTOOLS === '1';

if (process.env.SUNRISE_DEV_SCALE === '1') {
  // 开发机高 DPI 截图用：强制 1x，避免窗口大于物理屏幕。
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

app.setName('旭日东升');
app.setPath('userData', path.join(app.getPath('appData'), 'SunriseLauncher'));
app.commandLine.appendSwitch('force-color-profile', 'srgb');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
}

let win = null;
let nas = null;
let downloader = null;
let watcher = null;
let quitting = false;
let powerBlocker = -1;
let nasStatus = { connected: false, state: 'idle', message: '尚未连接', checkedAt: 0, latency: 0 };
let statusTimer = null;
const openedRecently = new Map();

function send(channel, payload) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch (_) { /* ignore */ }
}

function setNasStatus(next) {
  nasStatus = { ...nasStatus, ...next, checkedAt: Date.now() };
  send('nas:status', nasStatus);
  return nasStatus;
}

async function checkNasStatus(reason = 'auto') {
  if (quitting) return nasStatus;
  if (!nas) return nasStatus;
  setNasStatus({ state: 'checking', message: '正在连接课件库…' });
  try {
    await nas.login();
    const config = store.get();
    const listing = await nas.list(config.nas.defaultPath).catch(async () => {
      return nas.list('/').catch(() => null);
    });
    setNasStatus({
      connected: true,
      state: 'online',
      message: '课件库已连接',
      latency: 0,
      path: listing ? listing.path : config.nas.defaultPath,
      itemCount: listing ? listing.total : 0,
      reason,
    });
  } catch (err) {
    setNasStatus({
      connected: false,
      state: 'offline',
      message: err.message || '课件库未连接',
      code: err.code || '',
      reason,
    });
  }
  return nasStatus;
}

function applyAutoStart(enabled) {
  try {
    if (!app.isPackaged) return;
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: ['--autostart'],
    });
  } catch (err) {
    log.warn('设置开机自启失败:', err.message);
  }
}

function applyPowerSave(enabled) {
  try {
    if (enabled) {
      if (powerBlocker < 0 || !powerSaveBlocker.isStarted(powerBlocker)) {
        powerBlocker = powerSaveBlocker.start('prevent-display-sleep');
        log.info('已启用防息屏');
      }
    } else if (powerBlocker >= 0) {
      if (powerSaveBlocker.isStarted(powerBlocker)) powerSaveBlocker.stop(powerBlocker);
      powerBlocker = -1;
      log.info('已关闭防息屏');
    }
  } catch (err) {
    log.warn('设置防息屏失败:', err.message);
  }
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname || '/');
      if (rel === '/' || rel === '') rel = '/index.html';
      rel = rel.replace(/^\/+/, '');
      const filePath = path.normalize(path.join(RENDERER_ROOT, rel));
      if (!filePath.startsWith(RENDERER_ROOT + path.sep) && filePath !== RENDERER_ROOT) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const data = await fs.promises.readFile(filePath);
      const headers = {
        'Content-Type': mimeFor(filePath),
        'Cache-Control': app.isPackaged ? 'public, max-age=3600' : 'no-store',
      };
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(data.length) } });
      }
      return new Response(data, { status: 200, headers });
    } catch (err) {
      log.error('app:// 协议读取失败:', err.message);
      return new Response('Internal error', { status: 500 });
    }
  });
}

function blockShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    const blocked = (
      (ctrl && ['w', 'r', 'q', 'n', 'p', 's', 'f'].includes(key))
      || (ctrl && input.shift && ['i', 'j', 'c', 'r'].includes(key))
      || key === 'f5'
      || key === 'f11'
      || (input.alt && key === 'f4')
      || (ctrl && key === 'escape')
    );
    if (blocked) {
      if (DEV_WINDOW && (key === 'r' && ctrl && input.shift)) return;
      event.preventDefault();
    }
    if (DEV_WINDOW && key === 'f12') {
      contents.toggleDevTools();
    }
  });
}

function createWindow() {
  const display = require('electron').screen.getPrimaryDisplay();
  const work = display.workAreaSize;
  const devWidth = Math.min(1440, Math.max(900, work.width - 60));
  const devHeight = Math.min(900, Math.max(620, work.height - 80));
  log.info('显示信息:', JSON.stringify({
    size: display.size,
    workArea: display.workAreaSize,
    scaleFactor: display.scaleFactor,
    devWidth,
    devHeight,
  }));
  win = new BrowserWindow({
    width: DEV_WINDOW ? devWidth : undefined,
    height: DEV_WINDOW ? devHeight : undefined,
    x: DEV_WINDOW ? 40 : undefined,
    y: DEV_WINDOW ? 40 : undefined,
    show: false,
    frame: false,
    fullscreen: !DEV_WINDOW,
    resizable: DEV_WINDOW,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: !DEV_WINDOW,
    autoHideMenuBar: true,
    backgroundColor: '#05070a',
    title: APP_NAME,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: DEV_WINDOW || DEVTOOLS,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setMenu(null);
  if (!DEV_WINDOW) {
    win.setFullScreen(true);
  }
  log.info('窗口初始 bounds:', JSON.stringify(win.getBounds()));

  blockShortcuts(win.webContents);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://sunrise/')) event.preventDefault();
  });

  win.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  win.webContents.on('render-process-gone', (event, details) => {
    log.error('渲染进程退出:', details.reason, details.exitCode);
    if (!quitting) {
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.reload();
      }, 900);
    }
  });

  win.on('close', (event) => {
    if (quitting) return;
    if (DEV_WINDOW) return;
    event.preventDefault();
    send('shell:close-blocked');
  });

  win.on('minimize', () => {
    if (DEV_WINDOW) return;
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.restore();
        win.focus();
      }
    }, 30);
  });

  win.on('leave-full-screen', () => {
    if (DEV_WINDOW || quitting) return;
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.setFullScreen(true);
    }, 120);
  });

  win.once('ready-to-show', () => {
    if (DEV_WINDOW) {
      win.setBounds({ x: 40, y: 40, width: devWidth, height: devHeight });
    }
    win.show();
    win.focus();
    if (!DEV_WINDOW) {
      win.setFullScreen(true);
      taskbar.start();
    }
    log.info('窗口显示后 bounds:', JSON.stringify(win.getBounds()));
    if (DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.loadURL('app://sunrise/index.html').catch((err) => {
    log.error('加载界面失败:', err.message);
  });
}

function openDownloaded(filePath, source = 'watcher', force = false) {
  if (!filePath) return { ok: false, message: '文件路径为空' };
  if (!fs.existsSync(filePath)) {
    store.removeRecent(filePath);
    return { ok: false, message: '文件不存在或已被移动。' };
  }
  const now = Date.now();
  const last = openedRecently.get(filePath);
  if (!force && last && now - last < 12000) {
    log.info('跳过重复自动打开:', filePath);
    return { ok: true, skipped: true };
  }
  openedRecently.set(filePath, now);
  for (const [key, at] of openedRecently) {
    if (now - at > 5 * 60 * 1000) openedRecently.delete(key);
  }

  const config = store.get();
  const category = categoryOf(filePath);
  const toggleKey = category === 'other' ? 'other' : category;
  const enabled = config.autoOpen && (force || config.autoOpenTypes[toggleKey] !== false);
  if (!enabled && !force) {
    log.info('自动打开已关闭，跳过:', filePath);
    return { ok: false, disabled: true, message: '自动打开已关闭' };
  }

  apps.openFile(filePath, config).then((result) => {
    log.info('打开文件结果:', filePath, JSON.stringify(result));
    if (result.ok && result.mode === 'internal-image') {
      send('viewer:open', {
        path: filePath,
        name: path.basename(filePath),
        size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
        source,
      });
      return;
    }
    if (result.ok) {
      if (result.message) send('toast', { type: 'success', message: result.message, duration: 2600 });
    } else if (!result.disabled) {
      send('toast', {
        type: result.safe === false ? 'warning' : 'error',
        message: result.message || '无法打开文件',
        duration: 6000,
      });
    }
  }).catch((err) => {
    log.error('打开文件异常:', err.message);
    send('toast', { type: 'error', message: `打开文件失败：${err.message}`, duration: 6000 });
  });
  return { ok: true };
}

function restartWatcher() {
  if (!watcher) return;
  watcher.restart();
}

function applyConfigEffects(next, previous) {
  if (!previous || next.autoStart !== previous.autoStart) applyAutoStart(next.autoStart);
  if (!previous || next.preventSleep !== previous.preventSleep) applyPowerSave(next.preventSleep);
  if (!previous || next.downloadsDir !== previous.downloadsDir) restartWatcher();
  if (!previous || next.wpsPath !== previous.wpsPath) apps.invalidate();
}

async function requestQuit() {
  if (quitting) return;
  quitting = true;
  log.info('收到退出请求，正在恢复任务栏…');
  send('shell:quitting', {});
  try { store.flush(); } catch (_) { /* ignore */ }
  if (watcher) watcher.stop();
  if (downloader) downloader.cancelAll();
  if (statusTimer) clearInterval(statusTimer);
  try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
  try { await taskbar.restore(); } catch (err) { log.warn('恢复任务栏失败:', err.message); }
  if (powerBlocker >= 0) {
    try { if (powerSaveBlocker.isStarted(powerBlocker)) powerSaveBlocker.stop(powerBlocker); } catch (_) { /* ignore */ }
    powerBlocker = -1;
  }
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch (_) { /* ignore */ }
  app.exit(0);
}

function initServices() {
  nas = new NasClient(store.get);
  downloader = new DownloadManager({
    getConfig: store.get,
    nas,
    send,
    onCompleted: (result) => {
      openDownloaded(result.path, 'download', false);
    },
  });

  watcher = new DownloadsWatcher({
    getDir: () => store.ensureDownloadDir(store.get()),
    onNewFile: (filePath) => {
      openDownloaded(filePath, 'watcher', false);
    },
  });
  watcher.start();
  cleanupOldParts(store.get().downloadsDir);

  registerIpc({
    getWindow: () => win,
    nas,
    downloader,
    watcher,
    send,
    getNasStatus: () => nasStatus,
    setNasStatus,
    checkNasStatus,
    openDownloaded,
    requestQuit,
    applyConfigEffects,
    restartWatcher,
  });
}

function startStatusLoop() {
  checkNasStatus('startup');
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(() => {
    if (!quitting) checkNasStatus('periodic');
  }, 5 * 60 * 1000);
}

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    if (!DEV_WINDOW) win.setFullScreen(true);
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID);
  log.init(app.getPath('userData'));
  log.info('================ 旭日东升启动 ================');
  log.info('版本:', app.getVersion(), 'Electron:', process.versions.electron, 'Chrome:', process.versions.chrome);
  log.info('打包状态:', app.isPackaged, '开发窗口:', DEV_WINDOW);

  const config = store.init();
  registerAppProtocol();
  Menu.setApplicationMenu(null);
  initServices();
  createWindow();
  applyAutoStart(config.autoStart);
  applyPowerSave(config.preventSleep);

  try {
    globalShortcut.register('Control+Alt+Home', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        if (!DEV_WINDOW) win.setFullScreen(true);
      }
    });
    if (!app.isPackaged) {
      // 仅开发环境：方便测试退出/重载，正式安装包不注册。
      globalShortcut.register('Control+Alt+Q', () => requestQuit());
      globalShortcut.register('Control+Alt+R', () => {
        if (win && !win.isDestroyed()) win.reload();
      });
    }
  } catch (_) { /* ignore */ }

  startStatusLoop();

  app.on('activate', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
});

app.on('before-quit', (event) => {
  if (quitting) return;
  if (DEV_WINDOW) {
    quitting = true;
    return;
  }
  event.preventDefault();
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:close-blocked');
  }
});

app.on('window-all-closed', () => {
  // 保持应用存活；退出只能通过设置里的“退出旭日东升”。
});

process.on('uncaughtException', (err) => {
  log.error('主进程未捕获异常:', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  log.error('主进程未处理的 Promise 拒绝:', reason && reason.stack ? reason.stack : String(reason));
});

module.exports = { openDownloaded, requestQuit, send };
