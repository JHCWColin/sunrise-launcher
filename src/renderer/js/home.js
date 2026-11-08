import api from './api.js';
import { APP_ICON, ICON, fileVisual, extOfName } from './icons.js';
import {
  $, escapeHtml, formatBytes, relativeTime, setIcon, toast,
} from './ui.js';
import { state } from './state.js';

const ACTIONS = [
  {
    key: 'wps',
    kind: 'app',
    name: 'WPS Office',
    icon: APP_ICON.wps,
    rgb: '168, 196, 236',
    rgbLight: '91, 127, 168',
  },
  {
    key: 'board',
    kind: 'app',
    name: '希沃白板',
    icon: APP_ICON.board,
    rgb: '182, 201, 164',
    rgbLight: '111, 138, 94',
  },
  {
    key: 'camera',
    kind: 'app',
    name: '视频展台',
    icon: APP_ICON.camera,
    rgb: '201, 184, 232',
    rgbLight: '128, 106, 156',
  },
  {
    key: 'ftp',
    kind: 'ftp',
    name: 'FTP 课件',
    icon: APP_ICON.ftp,
    rgb: '232, 154, 120',
    rgbLight: '196, 99, 63',
  },
  {
    key: 'recent',
    kind: 'recent',
    name: '最近课件',
    icon: ICON.folderOpen,
    rgb: '232, 217, 196',
    rgbLight: '120, 98, 80',
  },
  {
    key: 'downloads',
    kind: 'downloads',
    name: '下载目录',
    icon: ICON.download,
    rgb: '232, 217, 196',
    rgbLight: '120, 98, 80',
  },
  {
    key: 'theme',
    kind: 'theme',
    name: '切换主题',
    icon: ICON.moon,
    rgb: '232, 217, 196',
    rgbLight: '120, 98, 80',
  },
  {
    key: 'settings',
    kind: 'settings',
    name: '设置',
    icon: ICON.gear,
    rgb: '217, 119, 87',
    rgbLight: '201, 100, 66',
  },
];

let hooks = {};

function renderDock() {
  const dock = $('#dock');
  if (!dock) return;
  dock.innerHTML = ACTIONS.map((action) => `
    <button class="action-item action-${action.key}" type="button" data-action="${action.key}"
      style="--item-rgb:${action.rgb};--item-rgb-light:${action.rgbLight}">
      <span class="action-icon">${action.icon}</span>
      <span class="action-name">${action.name}</span>
    </button>
  `).join('');

  dock.addEventListener('click', async (event) => {
    const item = event.target.closest('.action-item');
    if (!item) return;
    const action = ACTIONS.find((a) => a.key === item.dataset.action);
    if (!action) return;
    await handleAction(action, item);
  });
}

async function handleAction(action, item) {
  if (item.classList.contains('is-busy')) return;

  if (action.kind === 'ftp') {
    if (hooks.onOpenFiles) hooks.onOpenFiles();
    return;
  }
  if (action.kind === 'recent') {
    openRecentSheet();
    return;
  }
  if (action.kind === 'downloads') {
    const result = await api.openDownloadsFolder();
    if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开下载文件夹' });
    return;
  }
  if (action.kind === 'theme') {
    if (hooks.onToggleTheme) hooks.onToggleTheme();
    return;
  }
  if (action.kind === 'settings') {
    if (hooks.onOpenSettings) hooks.onOpenSettings();
    return;
  }

  const info = state.apps && state.apps[action.key];
  if (info && info.available === false) {
    toast({
      type: 'warning',
      message: action.key === 'wps'
        ? '未检测到 WPS Office，请确认已安装。'
        : action.key === 'board'
          ? '未检测到希沃白板 5，请确认已安装。'
          : '未检测到希沃视频展台，请确认已安装。',
      duration: 5200,
    });
    return;
  }

  item.classList.add('is-busy');
  try {
    const result = await api.launchApp(action.key);
    if (result && result.ok) {
      item.classList.add('is-done');
      toast({ type: 'success', message: result.message || '正在启动…', duration: 2400 });
      setTimeout(() => item.classList.remove('is-done'), 1600);
    } else {
      toast({ type: 'error', message: (result && result.message) || '启动失败', duration: 6000 });
    }
  } catch (err) {
    toast({ type: 'error', message: `启动失败：${err.message}`, duration: 6000 });
  } finally {
    item.classList.remove('is-busy');
  }
}

function updateRightStatus(status = state.nasStatus) {
  const box = $('#right-status');
  const text = $('#right-status-text');
  if (!box || !text) return;
  const dot = box.querySelector('.status-dot');
  if (dot) {
    dot.classList.toggle('offline', status.state === 'offline');
    dot.classList.toggle('checking', status.state === 'checking' || status.state === 'idle');
  }
  if (status.state === 'online') text.textContent = '课件库已连接';
  else if (status.state === 'checking') text.textContent = '正在连接课件库…';
  else if (status.state === 'offline') text.textContent = '课件库未连接';
  else text.textContent = '课件库待连接';
  box.title = status.message || '';
}

function updateThemeAction() {
  const item = document.querySelector('[data-action="theme"]');
  if (!item) return;
  const light = state.config && state.config.theme === 'light';
  const icon = item.querySelector('.action-icon');
  if (icon) setIcon(icon, light ? 'moon' : 'sunSmall');
}

export function updateThemeIcon() {
  updateThemeAction();
}

export function updateNasPill(status = state.nasStatus) {
  updateRightStatus(status);
}

function applyAvailability() {
  ACTIONS.forEach((action) => {
    if (action.kind !== 'app') return;
    const item = document.querySelector(`[data-action="${action.key}"]`);
    if (!item) return;
    const info = state.apps && state.apps[action.key];
    const missing = info && info.available === false;
    item.classList.toggle('is-missing', Boolean(missing));
  });
}

function renderRecentSheet() {
  const list = $('#recent-sheet-list');
  if (!list) return;
  const recent = Array.isArray(state.recent) ? state.recent : [];
  if (!recent.length) {
    list.innerHTML = `
      <div class="recent-sheet-empty">
        <span class="recent-sheet-empty-icon">${ICON.folderOpen}</span>
        <p>还没有打开过课件</p>
        <span>从 FTP 课件中打开文件后，会自动出现在这里。</span>
      </div>
    `;
    return;
  }
  list.innerHTML = recent.slice(0, 10).map((item) => {
    const ext = item.ext || extOfName(item.name || item.path);
    const visual = fileVisual(ext, false);
    return `
      <button class="recent-sheet-item" type="button" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.name)}">
        <span class="recent-sheet-icon" style="--chip-rgb:${visual.rgb}">${visual.svg}</span>
        <span class="recent-sheet-text">
          <b>${escapeHtml(item.name)}</b>
          <span>${relativeTime(item.at)}${item.size ? ` · ${formatBytes(item.size)}` : ''}</span>
        </span>
        <span class="recent-sheet-arrow">${ICON.chevronRight}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.recent-sheet-item').forEach((button) => {
    button.addEventListener('click', async () => {
      const path = button.dataset.path;
      if (!path) return;
      button.classList.add('is-busy');
      try {
        const result = await api.openDownloadFile(path);
        if (result && result.ok === false) {
          toast({ type: 'error', message: result.message || '无法打开文件', duration: 5600 });
        } else {
          closeRecentSheet();
        }
      } catch (err) {
        toast({ type: 'error', message: `无法打开文件：${err.message}`, duration: 5600 });
      } finally {
        button.classList.remove('is-busy');
      }
    });
  });
}

export function openRecentSheet() {
  const sheet = $('#recent-sheet');
  if (!sheet) return;
  renderRecentSheet();
  sheet.classList.remove('is-hidden');
  sheet.setAttribute('aria-hidden', 'false');
  const close = $('#recent-sheet-close');
  if (close) setIcon(close, 'close');
  setTimeout(() => close && close.focus({ preventScroll: true }), 60);
}

export function closeRecentSheet() {
  const sheet = $('#recent-sheet');
  if (!sheet) return;
  sheet.classList.add('is-hidden');
  sheet.setAttribute('aria-hidden', 'true');
}

export function isRecentSheetOpen() {
  const sheet = $('#recent-sheet');
  return Boolean(sheet && !sheet.classList.contains('is-hidden'));
}

function updateSideRecent() {
  const box = $('#side-recent');
  if (!box) return;
  const recent = state.recent || [];
  if (!recent.length) {
    box.innerHTML = '<p class="side-empty">打开过的课件会出现在这里。</p>';
    return;
  }
  box.innerHTML = recent.slice(0, 5).map((item) => {
    const ext = item.ext || extOfName(item.name || item.path);
    const visual = fileVisual(ext, false);
    return `
      <button class="side-recent-item" type="button" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.name)}">
        <span class="side-recent-icon" style="--chip-rgb:${visual.rgb}">${visual.svg}</span>
        <span class="side-recent-text">
          <span class="side-recent-name">${escapeHtml(item.name)}</span>
          <span class="side-recent-time">${relativeTime(item.at)}</span>
        </span>
      </button>
    `;
  }).join('');
  box.querySelectorAll('.side-recent-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const path = item.dataset.path;
      if (!path) return;
      try {
        const result = await api.openDownloadFile(path);
        if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开文件', duration: 5000 });
      } catch (err) {
        toast({ type: 'error', message: `无法打开文件：${err.message}`, duration: 5000 });
      }
    });
  });
}

function renderHomeRecent() {
  const block = $('#home-recent-block');
  const box = $('#home-recent');
  if (!box) return;
  const enabled = !state.config || state.config.showRecent !== false;
  if (block) block.classList.toggle('is-hidden', !enabled);
  if (!enabled) return;

  const recent = Array.isArray(state.recent) ? state.recent : [];
  if (!recent.length) {
    box.innerHTML = `
      <div class="home-recent-empty">
        ${ICON.folderOpen}
        <span>打开过的课件会出现在这里</span>
      </div>
    `;
    return;
  }

  box.innerHTML = recent.map((item) => {
    const ext = item.ext || extOfName(item.name || item.path);
    const visual = fileVisual(ext, false);
    const time = relativeTime(item.at);
    const meta = time.startsWith('今天 ') ? time.slice(3) : time;
    return `
      <button class="home-recent-item" type="button" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.name)}">
        <span class="home-recent-icon" style="--chip-rgb:${visual.rgb}">${visual.svg}</span>
        <span class="home-recent-text">
          <b>${escapeHtml(item.name)}</b>
          <span>${escapeHtml(meta)}</span>
        </span>
      </button>
    `;
  }).join('');
}

export function renderHome() {
  applyAvailability();
  updateRightStatus();
  updateThemeAction();
  updateSideRecent();
  renderRecentSheet();
  renderHomeRecent();
}

export function refreshHome() {
  renderHome();
}

export function refreshRecent() {
  renderRecentSheet();
  updateSideRecent();
  renderHomeRecent();
}

export function initHome(options = {}) {
  hooks = options;
  renderDock();
  const brand = $('#brand-mark');
  if (brand) brand.innerHTML = ICON.sun;

  const recentSheet = $('#recent-sheet');
  if (recentSheet) {
    recentSheet.addEventListener('click', (event) => {
      if (event.target === recentSheet) closeRecentSheet();
    });
  }
  const close = $('#recent-sheet-close');
  if (close) {
    setIcon(close, 'close');
    close.addEventListener('click', () => closeRecentSheet());
  }
  const folder = $('#recent-sheet-folder');
  if (folder) {
    folder.addEventListener('click', async () => {
      const result = await api.openDownloadsFolder();
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开下载文件夹' });
    });
  }

  const homeRecent = $('#home-recent');
  if (homeRecent) {
    homeRecent.addEventListener('click', async (event) => {
      const item = event.target.closest('.home-recent-item');
      if (!item) return;
      const path = item.dataset.path;
      if (!path) return;
      item.classList.add('is-busy');
      try {
        const result = await api.openDownloadFile(path);
        if (result && result.ok === false) {
          toast({ type: 'error', message: result.message || '无法打开文件', duration: 5600 });
        }
      } catch (err) {
        toast({ type: 'error', message: `无法打开文件：${err.message}`, duration: 5600 });
      } finally {
        item.classList.remove('is-busy');
      }
    });
  }

  renderHome();
}
