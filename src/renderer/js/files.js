import api from './api.js';
import { ICON, fileVisual, extOfName } from './icons.js';
import {
  $, $$, escapeHtml, formatBytes, formatFileTime, setIcon, toast,
} from './ui.js';
import { state } from './state.js';

const QUICK_LOCATIONS = [
  { label: '高三 · 语文', path: '/高三/语文', icon: 'folderOpen' },
  { label: '高三', path: '/高三', icon: 'folder' },
  { label: '高二', path: '/高二', icon: 'folder' },
  { label: '高一', path: '/高一', icon: 'folder' },
  { label: '教师文件夹', path: '/教师文件夹', icon: 'folder' },
  { label: '科技比赛', path: '/科技比赛', icon: 'folder' },
  { label: '全部共享', path: '/', icon: 'cloud' },
];

let hooks = {};
let dom = {};
let pageOpen = false;
let currentPath = '/';
let defaultPath = '/高三/语文';
let items = [];
let rendered = [];
let history = [];
let loading = false;
let error = null;
let filter = '';
let requestSeq = 0;
const pending = new Map();

function cacheDom() {
  dom.page = $('#files-page');
  dom.list = $('#files-list');
  dom.loading = $('#files-loading');
  dom.empty = $('#files-empty');
  dom.error = $('#files-error');
  dom.errorText = $('#files-error-text');
  dom.breadcrumb = $('#breadcrumb');
  dom.subtitle = $('#files-subtitle');
  dom.up = $('#files-up');
  dom.refresh = $('#files-refresh');
  dom.back = $('#files-back');
  dom.settings = $('#files-settings');
  dom.search = $('#files-search');
  dom.searchBox = dom.search ? dom.search.closest('.search-box') : null;
  dom.searchClear = $('#search-clear');
  dom.searchIcon = $('#search-icon');
  dom.serverPill = $('#files-server-pill');
  dom.quick = $('#quick-locations');
  dom.sideRecent = $('#side-recent');
  dom.sideDownloads = $('#side-open-downloads');
  dom.retry = $('#files-retry');
  dom.errorSettings = $('#files-error-settings');
  dom.emptyIcon = $('#empty-icon');
  dom.errorIcon = $('#error-icon');
}

function setIcons() {
  setIcon(dom.back, 'arrowLeft');
  setIcon(dom.refresh, 'refresh');
  setIcon(dom.settings, 'gear');
  setIcon(dom.up, 'arrowUp');
  setIcon(dom.searchIcon, 'search');
  setIcon(dom.emptyIcon, 'folderOpen');
  setIcon(dom.errorIcon, 'cloud');
}

function parentOf(path) {
  const parts = String(path || '/').split('/').filter(Boolean);
  if (!parts.length) return '/';
  if (parts.length === 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

function baseName(path) {
  const parts = String(path || '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '全部共享';
}

function buildQuickLocations() {
  if (!dom.quick) return;
  dom.quick.innerHTML = QUICK_LOCATIONS.map((q) => `
    <button class="quick-item" type="button" data-path="${escapeHtml(q.path)}">
      ${ICON[q.icon] || ICON.folder}<span>${escapeHtml(q.label)}</span>
    </button>
  `).join('');
  dom.quick.addEventListener('click', (event) => {
    const button = event.target.closest('.quick-item');
    if (!button) return;
    loadPath(button.dataset.path, { pushHistory: true });
  });
}

function renderBreadcrumb() {
  if (!dom.breadcrumb) return;
  const parts = String(currentPath || '/').split('/').filter(Boolean);
  let html = `<button class="crumb ${!parts.length ? 'is-current' : ''}" type="button" data-path="/">全部共享</button>`;
  let accumulated = '';
  parts.forEach((part, index) => {
    accumulated += `/${part}`;
    html += `<span class="crumb-sep" aria-hidden="true"></span>`;
    html += `<button class="crumb ${index === parts.length - 1 ? 'is-current' : ''}" type="button" data-path="${escapeHtml(accumulated)}">${escapeHtml(part)}</button>`;
  });
  dom.breadcrumb.innerHTML = html;
  dom.breadcrumb.querySelectorAll('.crumb').forEach((crumb) => {
    crumb.addEventListener('click', () => {
      const path = crumb.dataset.path;
      if (path && path !== currentPath) loadPath(path, { pushHistory: true });
    });
  });
  if (dom.up) {
    dom.up.disabled = currentPath === '/';
    dom.up.title = currentPath === '/' ? '已在最顶层' : `返回 ${parentOf(currentPath) === '/' ? '全部共享' : baseName(parentOf(currentPath))}`;
  }
}

function updateQuickActive() {
  if (!dom.quick) return;
  dom.quick.querySelectorAll('.quick-item').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.path === currentPath);
  });
}

function setServerPill(status) {
  if (!dom.serverPill) return;
  const dot = dom.serverPill.querySelector('.status-dot');
  const text = dom.serverPill.querySelector('span:last-child');
  if (dot) {
    dot.classList.toggle('offline', status.state === 'offline');
    dot.classList.toggle('checking', status.state === 'checking' || status.state === 'idle');
  }
  if (text) {
    if (status.state === 'online') text.textContent = 'NAS 已连接';
    else if (status.state === 'checking') text.textContent = '连接中…';
    else if (status.state === 'offline') text.textContent = 'NAS 未连接';
    else text.textContent = '等待连接';
  }
  dom.serverPill.title = status.message || '';
}

function updateSubtitle() {
  if (!dom.subtitle) return;
  const count = rendered.length;
  const label = currentPath === '/' ? '全部共享' : baseName(currentPath);
  dom.subtitle.textContent = `校园 NAS · ${label} · ${count} 项`;
}

function renderSideRecent() {
  if (!dom.sideRecent) return;
  const recent = state.recent || [];
  if (!recent.length) {
    dom.sideRecent.innerHTML = '<p class="side-empty">下载过的课件会出现在这里。</p>';
    return;
  }
  dom.sideRecent.innerHTML = recent.slice(0, 5).map((item) => {
    const ext = item.ext || extOfName(item.name || item.path);
    const visual = fileVisual(ext, false);
    return `
      <button class="side-recent-item" type="button" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.name)}">
        <span class="side-recent-icon" style="--chip-rgb:${visual.rgb}">${visual.svg}</span>
        <span class="side-recent-text">
          <span class="side-recent-name">${escapeHtml(item.name)}</span>
          <span class="side-recent-time">${formatFileTime(item.at)}</span>
        </span>
      </button>
    `;
  }).join('');
  dom.sideRecent.querySelectorAll('.side-recent-item').forEach((button) => {
    button.addEventListener('click', async () => {
      const path = button.dataset.path;
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

function rowHtml(entry, index) {
  const { item, visual } = entry;
  const pendingInfo = pending.get(item.path);
  const ext = item.isdir ? '' : (extOfName(item.name) || '');
  const kind = item.isdir ? '文件夹' : visual.label;
  const busy = Boolean(pendingInfo);
  const percent = pendingInfo && pendingInfo.total
    ? Math.max(0, Math.min(100, Math.round((pendingInfo.received / pendingInfo.total) * 100)))
    : 0;
  return `
    <div class="file-row ${item.isdir ? 'is-folder' : ''} ${busy ? 'is-downloading' : ''}"
         data-index="${index}" data-nas-path="${escapeHtml(item.path)}" role="listitem" tabindex="0"
         style="--file-rgb:${visual.rgb};--row-i:${Math.min(index, 14)}">
      <div class="file-main">
        <span class="file-icon">${visual.svg}</span>
        <span class="file-text">
          <span class="file-name">${escapeHtml(item.name)}</span>
          <span class="file-kind">${escapeHtml(kind)}${ext && !item.isdir ? ` · .${escapeHtml(ext)}` : ''}</span>
        </span>
      </div>
      <span class="file-size">${item.isdir ? '—' : formatBytes(item.size)}</span>
      <span class="file-time">${formatFileTime(item.mtime)}</span>
      <span class="file-action">${item.isdir ? ICON.chevronRight : (busy ? '<span class="spinner" style="width:15px;height:15px;border-width:1.6px"></span>' : ICON.download)}</span>
      ${busy ? `<span class="file-progress"><i style="width:${percent}%"></i></span>` : ''}
    </div>
  `;
}

function renderList() {
  if (!dom.list) return;
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) => String(item.name || '').toLowerCase().includes(needle))
    : items;
  rendered = filtered.map((item) => {
    const ext = item.isdir ? '' : extOfName(item.name);
    return { item, visual: fileVisual(ext, item.isdir) };
  });

  dom.list.innerHTML = rendered.map((entry, index) => rowHtml(entry, index)).join('');
  updateSubtitle();

  const showLoading = loading;
  const showError = !loading && Boolean(error);
  const showEmpty = !loading && !error && rendered.length === 0;
  dom.list.classList.toggle('is-hidden', showLoading || showError || showEmpty);
  dom.loading.classList.toggle('is-hidden', !showLoading);
  dom.error.classList.toggle('is-hidden', !showError);
  dom.empty.classList.toggle('is-hidden', !showEmpty);
}

function renderAll() {
  renderBreadcrumb();
  updateQuickActive();
  renderList();
}

function showError(err) {
  error = err;
  items = [];
  loading = false;
  if (dom.errorText) {
    const host = state.config && state.config.nas ? state.config.nas.host : '';
    const detail = err && err.message ? err.message : '未知错误';
    dom.errorText.textContent = host
      ? `${detail}\n服务器：${host}。请检查网络连接、NAS 地址或稍后重试。`
      : detail;
  }
  renderList();
}

async function loadPath(path, { pushHistory = true, initial = false } = {}) {
  if (!path || !String(path).startsWith('/')) return;
  if (pushHistory && currentPath && currentPath !== path) history.push(currentPath);
  currentPath = path;
  filter = '';
  loading = true;
  error = null;
  if (dom.search) dom.search.value = '';
  if (dom.searchBox) dom.searchBox.classList.remove('has-value');
  renderBreadcrumb();
  updateQuickActive();
  renderList();
  const seq = ++requestSeq;
  try {
    const result = await api.nasList(path);
    if (seq !== requestSeq) return;
    if (!result || !result.ok) {
      const isNetwork = result && ['NETWORK', 'TIMEOUT', 'DOWNLOAD_502'].includes(result.code);
      setServerPill(isNetwork
        ? { state: 'offline', message: result.message }
        : { state: 'online', message: '课件库已连接，但当前目录不可用' });
      showError(result || { message: '无法读取目录' });
      return;
    }
    loading = false;
    error = null;
    items = Array.isArray(result.items) ? result.items : [];
    setServerPill({ state: 'online', message: '课件库已连接' });
    state.nasStatus = { ...(state.nasStatus || {}), connected: true, state: 'online', message: '课件库已连接' };
    renderList();
    if (dom.list) dom.list.scrollTop = 0;
    if (initial && !items.length) {
      toast({ type: 'info', message: '这个文件夹还是空的，可以从左侧切换位置。', duration: 3600 });
    }
  } catch (err) {
    if (seq !== requestSeq) return;
    setServerPill({ state: 'offline', message: err.message });
    showError({ message: err.message || '无法读取目录' });
  }
}

function setRowDownloading(row, received, total) {
  if (!row) return;
  row.classList.add('is-downloading');
  row.classList.remove('is-done', 'is-error');
  const action = row.querySelector('.file-action');
  if (action) action.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:1.6px"></span>';
  let bar = row.querySelector('.file-progress');
  if (!bar) {
    bar = document.createElement('span');
    bar.className = 'file-progress';
    bar.innerHTML = '<i></i>';
    row.appendChild(bar);
  }
  const fill = bar.querySelector('i');
  const percent = total ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : 0;
  if (fill) fill.style.width = `${percent}%`;
}

function setRowDone(row) {
  if (!row) return;
  row.classList.remove('is-downloading', 'is-error');
  row.classList.add('is-done');
  const action = row.querySelector('.file-action');
  if (action) action.innerHTML = ICON.check;
  const bar = row.querySelector('.file-progress');
  if (bar) {
    const fill = bar.querySelector('i');
    if (fill) fill.style.width = '100%';
    setTimeout(() => bar.remove(), 800);
  }
  setTimeout(() => row.classList.remove('is-done'), 2600);
}

function setRowError(row, message) {
  if (!row) return;
  row.classList.remove('is-downloading');
  row.classList.add('is-error');
  const action = row.querySelector('.file-action');
  if (action) action.innerHTML = ICON.warning;
  const bar = row.querySelector('.file-progress');
  if (bar) bar.remove();
  row.title = message || '下载失败';
  setTimeout(() => row.classList.remove('is-error'), 4000);
}

function findRowByNasPath(path) {
  if (!dom.list) return null;
  return Array.from(dom.list.querySelectorAll('.file-row')).find((row) => row.dataset.nasPath === path) || null;
}

async function downloadItem(item, row) {
  if (!item || item.isdir) return;
  if (pending.has(item.path)) {
    toast({ type: 'info', message: '这个文件已经在下载队列里了。', duration: 2400 });
    return;
  }
  const info = { id: '', received: 0, total: Number(item.size) || 0, status: 'downloading', method: 'file-station' };
  pending.set(item.path, info);
  setRowDownloading(row, 0, info.total);
  try {
    const result = await api.nasDownload(item.path, item.name, item.size);
    if (!result || !result.ok) {
      pending.delete(item.path);
      setRowError(row, result && result.message);
      toast({ type: 'error', message: (result && result.message) || '下载失败', duration: 7000 });
      return;
    }
    pending.delete(item.path);
    setRowDone(row);
    if (state.config && state.config.autoOpen === false) {
      toast({
        type: 'success',
        message: `已下载：${result.name || item.name}`,
        actionLabel: '打开',
        duration: 6000,
        onAction: () => api.openDownloadFile(result.path),
      });
    }
  } catch (err) {
    pending.delete(item.path);
    setRowError(row, err.message);
    toast({ type: 'error', message: `下载失败：${err.message}`, duration: 7000 });
  }
}

function bind() {
  if (dom.back) dom.back.addEventListener('click', () => closeFilesPage());
  if (dom.refresh) dom.refresh.addEventListener('click', () => loadPath(currentPath, { pushHistory: false }));
  if (dom.up) dom.up.addEventListener('click', () => {
    if (currentPath === '/') return;
    loadPath(parentOf(currentPath), { pushHistory: true });
  });
  if (dom.settings) dom.settings.addEventListener('click', () => hooks.onOpenSettings && hooks.onOpenSettings());
  if (dom.retry) dom.retry.addEventListener('click', () => loadPath(currentPath, { pushHistory: false }));
  if (dom.errorSettings) dom.errorSettings.addEventListener('click', () => hooks.onOpenSettings && hooks.onOpenSettings());
  if (dom.sideDownloads) {
    dom.sideDownloads.addEventListener('click', async () => {
      const result = await api.openDownloadsFolder();
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开下载文件夹' });
    });
  }

  if (dom.search) {
    dom.search.addEventListener('input', () => {
      filter = dom.search.value;
      dom.searchBox.classList.toggle('has-value', Boolean(dom.search.value));
      renderList();
    });
    dom.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        dom.search.value = '';
        filter = '';
        dom.searchBox.classList.remove('has-value');
        renderList();
      }
    });
  }
  if (dom.searchClear) {
    dom.searchClear.addEventListener('click', () => {
      dom.search.value = '';
      filter = '';
      dom.searchBox.classList.remove('has-value');
      renderList();
      dom.search.focus();
    });
  }

  if (dom.list) {
    dom.list.addEventListener('click', (event) => {
      const row = event.target.closest('.file-row');
      if (!row) return;
      const index = Number(row.dataset.index);
      const entry = rendered[index];
      if (!entry) return;
      if (entry.item.isdir) {
        loadPath(entry.item.path, { pushHistory: true });
      } else {
        downloadItem(entry.item, row);
      }
    });
    dom.list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.file-row');
      if (!row) return;
      event.preventDefault();
      row.click();
    });
  }
}

function subscribe() {
  api.onDownloadStart((payload) => {
    if (!payload || !payload.nasPath) return;
    const info = pending.get(payload.nasPath) || { received: 0, total: 0 };
    pending.set(payload.nasPath, {
      ...info,
      id: payload.id,
      total: payload.size || info.total || 0,
      status: 'downloading',
      method: 'file-station',
    });
    const row = findRowByNasPath(payload.nasPath);
    if (row) setRowDownloading(row, info.received || 0, payload.size || info.total || 0);
  });

  api.onDownloadProgress((payload) => {
    if (!payload || !payload.nasPath) return;
    const info = pending.get(payload.nasPath);
    if (info) {
      info.received = payload.received || 0;
      if (payload.total) info.total = payload.total;
      info.method = payload.method || info.method;
    }
    const row = findRowByNasPath(payload.nasPath);
    if (row) setRowDownloading(row, payload.received || 0, payload.total || (info && info.total) || 0);
  });

  api.onDownloadFallback((payload) => {
    if (!payload || !payload.nasPath) return;
    const info = pending.get(payload.nasPath);
    if (info) info.method = 'smb';
  });

  api.onDownloadComplete((payload) => {
    if (!payload || !payload.nasPath) return;
    pending.delete(payload.nasPath);
    const row = findRowByNasPath(payload.nasPath);
    if (row) setRowDone(row);
  });

  api.onDownloadError((payload) => {
    if (!payload || !payload.nasPath) return;
    pending.delete(payload.nasPath);
    const row = findRowByNasPath(payload.nasPath);
    if (row) setRowError(row, payload.message);
  });

  api.onNasStatus((status) => {
    state.nasStatus = status;
    setServerPill(status);
  });

  api.onRecentUpdated((recent) => {
    state.recent = Array.isArray(recent) ? recent : [];
    renderSideRecent();
  });
}

export function initFiles(options = {}) {
  hooks = options;
  cacheDom();
  setIcons();
  buildQuickLocations();
  bind();
  subscribe();
  renderSideRecent();
  setServerPill(state.nasStatus || { state: 'idle' });
  if (dom.serverPill) {
    const text = dom.serverPill.querySelector('span:last-child');
    if (text) text.textContent = '等待连接';
  }
}

export function openFilesPage({ reset = true } = {}) {
  defaultPath = (state.config && state.config.nas && state.config.nas.defaultPath) || '/高三/语文';
  pageOpen = true;
  state.page = 'files';
  if (!dom.page) return;
  dom.page.classList.add('is-open');
  dom.page.setAttribute('aria-hidden', 'false');
  if (reset || !currentPath) {
    currentPath = defaultPath;
    history = [];
  }
  renderSideRecent();
  setServerPill(state.nasStatus || { state: 'idle' });
  loadPath(currentPath, { pushHistory: false, initial: true });
  if (dom.search) setTimeout(() => dom.search.blur(), 60);
}

export function closeFilesPage() {
  pageOpen = false;
  state.page = 'home';
  if (dom.page) {
    dom.page.classList.remove('is-open');
    dom.page.setAttribute('aria-hidden', 'true');
  }
  if (hooks.onClose) hooks.onClose();
}

export function isFilesOpen() {
  return pageOpen;
}

export function refreshFilesView() {
  if (!pageOpen) return;
  renderSideRecent();
  loadPath(currentPath, { pushHistory: false });
}

export function updateFilesNasStatus(status) {
  state.nasStatus = status;
  setServerPill(status);
}

export function updateFilesRecent() {
  renderSideRecent();
}
