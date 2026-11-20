import api from './api.js';
import { setStateFromPayload, state } from './state.js';
import {
  $, applyAccent, applyBackground, applyBgDim, applyGlass, applyGlow, applyMotion, applyTheme,
  closeActiveModal, initCursorIdle, toast,
} from './ui.js';
import {
  initHome, refreshHome, refreshRecent, updateNasPill, updateUsbEntry,
  isRecentSheetOpen, closeRecentSheet,
} from './home.js';
import {
  initFiles, openFilesPage, closeFilesPage, isFilesOpen,
  updateFilesNasStatus, updateFilesRecent,
} from './files.js';
import {
  initSettings, openSettings, closeSettings, isSettingsOpen,
  refreshSettings,
} from './settings.js';
import { initDownloadsUI } from './downloads-ui.js';
import {
  initImageViewer, openImageViewer, closeImageViewer, isImageViewerOpen,
} from './viewer.js';
import {
  initUsbBrowser, openUsbBrowser, closeUsbBrowser, isUsbBrowserOpen, usbDrivesChanged,
} from './usb-ui.js';
import { startClock } from './clock.js';
import { initAod, isAodActive } from './aod.js';
import { playIntro } from './intro.js';

let offlineNotified = false;
let shell;

function revealShell() {
  if (!shell) shell = $('#shell');
  if (!shell) return;
  shell.classList.add('is-visible');
  shell.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-ready');
  refreshHome();
  updateUsbEntry();
  setTimeout(() => {
    api.focusWindow().catch(() => {});
  }, 260);
}

function showFiles() {
  if (shell) shell.classList.add('is-behind');
  openFilesPage({ reset: true });
}

function hideFiles() {
  if (shell) shell.classList.remove('is-behind');
  closeFilesPage();
}

async function showUsb() {
  // v1.8.0：多个 U 盘时先弹「选择 U 盘」对话框，取消则不进入页面，
  // 主界面也不进入半透明退场状态（is-behind 只在真正打开页面后才加）。
  const opened = await openUsbBrowser();
  if (opened && shell) shell.classList.add('is-behind');
}

function hideUsb() {
  if (shell) shell.classList.remove('is-behind');
  closeUsbBrowser();
}

function handleEscape(event) {
  if (event.key !== 'Escape') return;
  if (isAodActive()) return; // 熄屏层的键盘监听已负责唤醒，不碰底下的界面
  const modal = document.getElementById('modal-layer');
  if (modal && !modal.classList.contains('is-hidden')) {
    closeActiveModal();
    event.preventDefault();
    return;
  }
  if (isImageViewerOpen()) {
    closeImageViewer();
    event.preventDefault();
    return;
  }
  if (isRecentSheetOpen()) {
    closeRecentSheet();
    event.preventDefault();
    return;
  }
  if (isSettingsOpen()) {
    closeSettings();
    event.preventDefault();
    return;
  }
  if (isUsbBrowserOpen()) {
    hideUsb();
    event.preventDefault();
    return;
  }
  if (isFilesOpen()) {
    hideFiles();
    event.preventDefault();
  }
}

function bindGlobalEvents() {
  api.onToast((payload) => {
    if (payload) toast(payload);
  });

  api.onViewerOpen((payload) => {
    api.log('info', `收到 viewer:open ${payload && payload.path ? payload.path : ''}`);
    if (payload && payload.path) openImageViewer(payload).catch((err) => {
      api.log('error', `openImageViewer failed: ${err.message}`);
    });
  });

  api.onCloseBlocked(() => {
    toast({
      type: 'warning',
      message: '请前往「设置 → 退出旭日东升」关闭软件。',
      actionLabel: '打开设置',
      duration: 6500,
      onAction: () => openSettings(),
    });
  });

  api.onQuitting(() => {
    document.documentElement.classList.add('is-quitting');
  });

  api.onNasStatus((status) => {
    if (!status) return;
    state.nasStatus = status;
    updateNasPill(status);
    updateFilesNasStatus(status);
    if (status.state === 'offline') {
      if (!offlineNotified && !isSettingsOpen()) {
        offlineNotified = true;
        setTimeout(() => {
          toast({
            type: 'warning',
            message: `课件库暂时未连接：${status.message || '请检查网络'}`,
            actionLabel: '检查设置',
            duration: 7200,
            onAction: () => openSettings(),
          });
        }, 700);
      }
    } else if (status.state === 'online') {
      offlineNotified = false;
    }
    if (isSettingsOpen()) refreshSettings();
  });

  api.onRecentUpdated((recent) => {
    state.recent = Array.isArray(recent) ? recent : [];
    refreshRecent();
    updateFilesRecent();
  });

  api.onUsbDrives((payload) => {
    if (!payload) return;
    const drives = Array.isArray(payload.drives) ? payload.drives : [];
    state.usbDrives = drives;
    updateUsbEntry(drives);
    usbDrivesChanged(drives);
  });

  window.addEventListener('keydown', handleEscape);
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  window.addEventListener('error', (event) => {
    try {
      api.log('error', `${event.message || 'renderer error'} @ ${event.filename || ''}:${event.lineno || 0}`);
    } catch (_) { /* ignore */ }
  });
  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      api.log('error', `unhandled rejection: ${reason && reason.stack ? reason.stack : String(reason)}`);
    } catch (_) { /* ignore */ }
  });
}

async function boot() {
  shell = $('#shell');
  bindGlobalEvents();

  let payload;
  try {
    payload = await api.getState();
  } catch (err) {
    toast({ type: 'error', message: `启动器初始化失败：${err.message}`, duration: 9000 });
    revealShell();
    return;
  }
  if (!payload) {
    revealShell();
    return;
  }

  setStateFromPayload(payload);
  const config = state.config;

  applyTheme(config.theme);
  applyAccent(config.accent);
  applyGlass(config.glass);
  applyGlow(config.glow);
  applyBgDim(config);
  applyBackground(config);
  applyMotion(config.reduceMotion);

  initHome({
    onOpenFiles: showFiles,
    onOpenSettings: openSettings,
    onOpenUsb: showUsb,
  });
  initFiles({
    onOpenSettings: openSettings,
    onClose: () => {
      if (shell) shell.classList.remove('is-behind');
      refreshHome();
      api.focusWindow().catch(() => {});
    },
  });
  initSettings({
    onClose: () => {
      refreshHome();
      api.focusWindow().catch(() => {});
    },
  });
  initDownloadsUI();
  initImageViewer();
  initUsbBrowser({
    onClose: () => {
      // v1.5 修复：退出 USB 页面时必须移除 shell 的 is-behind，
      // 否则主界面停留在半透明且不可交互的状态（表现为画面卡死）。
      if (shell) shell.classList.remove('is-behind');
      refreshHome();
      api.focusWindow().catch(() => {});
    },
  });
  initCursorIdle();
  startClock(config);
  initAod(config);

  // 拉取一次当前 U 盘状态（事件可能在页面加载前就已发出）。
  api.usbDrives().then((res) => {
    if (res && Array.isArray(res.drives)) {
      state.usbDrives = res.drives;
      updateUsbEntry(res.drives);
      usbDrivesChanged(res.drives);
    }
  }).catch(() => {});

  playIntro({
    reduceMotion: config.reduceMotion,
    skip: config.skipIntro,
    style: config.introStyle,
    sound: config.introSound !== false,
    version: (state.app && state.app.version) || '',
    onDone: () => {
      revealShell();
      api.nasStatus(true).catch(() => {});
    },
  });

  if (config.reduceMotion) {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
  }
  document.title = (state.app && state.app.name) || '旭日东升';
  api.log('info', `renderer ready · v${(state.app && state.app.version) || ''} · ${config.theme} · viewport ${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}x · NAS ${config.nas.host}:${config.nas.port}`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
