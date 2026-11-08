import api from './api.js';
import { setStateFromPayload, state } from './state.js';
import {
  $, applyAccent, applyGlass, applyMotion, applyTheme, closeActiveModal,
  initCursorIdle, toast,
} from './ui.js';
import {
  initHome, refreshHome, refreshRecent, updateNasPill, updateThemeIcon,
  isRecentSheetOpen, closeRecentSheet,
} from './home.js';
import {
  initFiles, openFilesPage, closeFilesPage, isFilesOpen,
  updateFilesNasStatus, updateFilesRecent,
} from './files.js';
import {
  initSettings, openSettings, closeSettings, isSettingsOpen,
  setThemeAndSave, refreshSettings,
} from './settings.js';
import { initDownloadsUI } from './downloads-ui.js';
import {
  initImageViewer, openImageViewer, closeImageViewer, isImageViewerOpen,
} from './viewer.js';
import { startClock } from './clock.js';
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
  updateThemeIcon();
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

function handleEscape(event) {
  if (event.key !== 'Escape') return;
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

async function toggleTheme() {
  const next = state.config && state.config.theme === 'dark' ? 'light' : 'dark';
  await setThemeAndSave(next);
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
  applyMotion(config.reduceMotion);

  initHome({
    onOpenFiles: showFiles,
    onOpenSettings: openSettings,
    onToggleTheme: toggleTheme,
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
  initCursorIdle();
  startClock(config);

  const introDev = $('#intro-dev');
  if (introDev) introDev.textContent = config.developer;

  playIntro({
    developer: config.developer,
    reduceMotion: config.reduceMotion,
    skip: config.skipIntro,
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
