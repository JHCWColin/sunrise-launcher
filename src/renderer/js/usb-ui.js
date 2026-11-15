import api from './api.js';
import { ICON, fileVisual, extOfName } from './icons.js';
import {
  $, escapeHtml, formatBytes, formatFileTime, formatSpeed, openModal, setIcon, toast,
} from './ui.js';
import { state } from './state.js';

/**
 * 移动存储设备（U 盘）双向拷贝浏览器。
 * 左侧：本机课件（下载文件夹 / 桌面，仅课程类资源，文件夹进入次级）；
 * 右侧：U 盘全部文件。勾选（单选 / 多选）后双向拷贝，带进度条与取消。
 */

let hooks = {};
let dom = {};
let pageOpen = false;
let localRootId = 'downloads';
let localRel = '';
let localRootLabel = '下载文件夹';
let localItems = [];
let usbRel = '';
let usbItems = [];
let activeDrive = null; // { letter, label, fs, size, free }
let selection = { local: new Set(), usb: new Set() };
let copying = false;
let copyId = 0;
let filterLocal = '';
let filterUsb = '';
let requestSeq = { local: 0, usb: 0 };

/* ---------------- 工具 ---------------- */

function parentRel(rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(0, -1).join('/');
}

function baseNameOf(rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function findItem(side, rel) {
  const items = side === 'local' ? localItems : usbItems;
  return items.find((item) => item.rel === rel) || null;
}

function selectedFiles(side) {
  return Array.from(selection[side])
    .map((rel) => findItem(side, rel))
    .filter((item) => item && !item.isdir);
}

/* ---------------- 渲染 ---------------- */

function rowHtml(entry, index, side) {
  const { item, visual } = entry;
  const ext = item.isdir ? '' : (extOfName(item.name) || '');
  const kind = item.isdir ? '文件夹' : visual.label;
  const selected = selection[side].has(item.rel);
  return `
    <div class="file-row usb-row ${item.isdir ? 'is-folder' : ''} ${selected ? 'is-selected' : ''}"
         data-index="${index}" data-rel="${escapeHtml(item.rel)}" data-side="${side}" role="listitem" tabindex="0"
         style="--file-rgb:${visual.rgb}">
      <span class="usb-check">${ICON.check}</span>
      <div class="file-main">
        <span class="file-icon">${visual.svg}</span>
        <span class="file-text">
          <span class="file-name">${escapeHtml(item.name)}</span>
          <span class="file-kind">${escapeHtml(kind)}${ext && !item.isdir ? ` · .${escapeHtml(ext)}` : ''}</span>
        </span>
      </div>
      <span class="file-size">${item.isdir ? '—' : formatBytes(item.size)}</span>
      <span class="file-time">${formatFileTime(item.mtime)}</span>
      <span class="file-action">${item.isdir ? ICON.chevronRight : (selected ? ICON.check : ICON.usb)}</span>
    </div>
  `;
}

function renderList(side) {
  const listEl = side === 'local' ? dom.localList : dom.usbList;
  if (!listEl) return;
  const needle = (side === 'local' ? filterLocal : filterUsb).trim().toLowerCase();
  const items = side === 'local' ? localItems : usbItems;
  const filtered = needle
    ? items.filter((item) => String(item.name || '').toLowerCase().includes(needle))
    : items;
  const rendered = filtered.map((item) => {
    const ext = item.isdir ? '' : extOfName(item.name);
    return { item, visual: fileVisual(ext, item.isdir) };
  });
  listEl.innerHTML = rendered.map((entry, index) => rowHtml(entry, index, side)).join('');

  const loading = side === 'local' ? dom.localLoading : dom.usbLoading;
  const empty = side === 'local' ? dom.localEmpty : dom.usbEmpty;
  const missing = side === 'usb' ? dom.usbMissing : null;
  const noDrive = side === 'usb' && !activeDrive;
  const showList = !noDrive && rendered.length > 0;
  const showEmpty = !noDrive && rendered.length === 0;
  if (listEl) listEl.classList.toggle('is-hidden', !showList);
  if (loading) loading.classList.toggle('is-hidden', true);
  if (empty) empty.classList.toggle('is-hidden', !showEmpty);
  if (missing) missing.classList.toggle('is-hidden', !noDrive);
  updatePaneMeta(side);
}

function renderBreadcrumb(side) {
  const nav = side === 'local' ? dom.localCrumbs : dom.usbCrumbs;
  if (!nav) return;
  const rel = side === 'local' ? localRel : usbRel;
  const rootLabel = side === 'local' ? localRootLabel : (activeDrive ? `${activeDrive.letter}${activeDrive.label ? ` ${activeDrive.label}` : ''}` : 'U 盘');
  const parts = String(rel || '').split('/').filter(Boolean);
  let html = `<button class="crumb ${!parts.length ? 'is-current' : ''}" type="button" data-rel="">${escapeHtml(rootLabel)}</button>`;
  let acc = '';
  parts.forEach((part, index) => {
    acc += `${part}`;
    html += `<span class="crumb-sep" aria-hidden="true"></span>`;
    html += `<button class="crumb ${index === parts.length - 1 ? 'is-current' : ''}" type="button" data-rel="${escapeHtml(acc)}">${escapeHtml(part)}</button>`;
    acc += '/';
  });
  nav.innerHTML = html;
  nav.querySelectorAll('.crumb').forEach((crumb) => {
    crumb.addEventListener('click', () => {
      const target = crumb.dataset.rel || '';
      if (target !== rel) loadDir(side, target);
    });
  });
  const upBtn = side === 'local' ? dom.localUp : dom.usbUp;
  if (upBtn) upBtn.disabled = !parts.length;
}

function updatePaneMeta(side) {
  if (side === 'local') {
    if (dom.localTitle) dom.localTitle.textContent = `本机课件 · ${localRootLabel}`;
    if (dom.localUp) dom.localUp.title = localRel ? `返回 ${baseNameOf(parentRel(localRel)) || localRootLabel}` : '已在最顶层';
    renderSelectionInfo('local');
  } else {
    const drive = activeDrive;
    if (dom.usbTitle) dom.usbTitle.textContent = drive ? `${drive.letter}${drive.label ? ` ${drive.label}` : ''}` : '未插入 U 盘';
    if (dom.usbFree) {
      dom.usbFree.textContent = drive
        ? `剩余 ${formatBytes(drive.free)} / ${formatBytes(drive.size)}`
        : '—';
    }
    renderSelectionInfo('usb');
  }
  updateCopyButtons();
}

function renderSelectionInfo(side) {
  const info = side === 'local' ? dom.localInfo : dom.usbInfo;
  if (!info) return;
  const files = selectedFiles(side);
  if (!files.length) {
    info.textContent = '未选择文件';
    return;
  }
  const total = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  info.innerHTML = `已选 <b>${files.length}</b> 个文件 · ${formatBytes(total)}`;
}

/* v1.5：勾选 / 取消勾选时只更新受影响行的 class 与图标，不再整表重建 innerHTML，
   避免每次点选都让整个列表视觉上「重新淡入」一次。 */
function syncRowSelection(side) {
  const listEl = side === 'local' ? dom.localList : dom.usbList;
  if (!listEl) return;
  listEl.querySelectorAll('.usb-row').forEach((row) => {
    if (row.dataset.side !== side) return;
    const rel = row.dataset.rel || '';
    const selected = selection[side].has(rel);
    row.classList.toggle('is-selected', selected);
    const action = row.querySelector('.file-action');
    if (action) {
      const item = findItem(side, rel);
      const icon = item && item.isdir ? ICON.chevronRight : (selected ? ICON.check : ICON.usb);
      if (action.innerHTML !== icon) action.innerHTML = icon;
    }
  });
  renderSelectionInfo(side);
  updateCopyButtons();
}

function updateCopyButtons() {
  if (dom.copyToUsb) {
    dom.copyToUsb.disabled = copying || !activeDrive || selectedFiles('local').length === 0;
    const n = selectedFiles('local').length;
    dom.copyToUsb.textContent = n > 1 ? `拷贝 ${n} 个到 U 盘 →` : '拷贝到 U 盘 →';
  }
  if (dom.copyToLocal) {
    dom.copyToLocal.disabled = copying || !activeDrive || selectedFiles('usb').length === 0;
    const n = selectedFiles('usb').length;
    dom.copyToLocal.textContent = n > 1 ? `← 拷贝 ${n} 个到桌面` : '← 拷贝到桌面';
  }
}

function renderRoots() {
  if (!dom.localRoots) return;
  dom.localRoots.querySelectorAll('button[data-root]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.root === localRootId);
  });
}

function updateDrivePill() {
  if (!dom.deviceText || !dom.devicePill) return;
  const drive = activeDrive;
  const dot = dom.devicePill.querySelector('.status-dot');
  if (dot) {
    dot.classList.toggle('offline', !drive);
    dot.classList.toggle('checking', false);
  }
  if (drive) {
    dom.deviceText.textContent = `${drive.letter}${drive.label ? ` ${drive.label}` : ''}${state.usbDrives.length > 1 ? ` · 共 ${state.usbDrives.length} 个` : ''}`;
    dom.devicePill.title = state.usbDrives.length > 1 ? '点击切换 U 盘' : drive.label || drive.letter;
    dom.devicePill.disabled = state.usbDrives.length <= 1;
  } else {
    dom.deviceText.textContent = '未插入 U 盘';
    dom.devicePill.title = '把 U 盘插入一体机的 USB 接口';
    dom.devicePill.disabled = true;
  }
}

/* ---------------- 数据加载 ---------------- */

async function loadDir(side, rel) {
  const seq = ++requestSeq[side];
  const loading = side === 'local' ? dom.localLoading : dom.usbLoading;
  const listEl = side === 'local' ? dom.localList : dom.usbList;
  if (side === 'local') localRel = rel;
  else usbRel = rel;
  selection[side].clear();
  if (side === 'local') filterLocal = ''; else filterUsb = '';
  const search = side === 'local' ? dom.localSearch : dom.usbSearch;
  const searchBox = search ? search.closest('.search-box') : null;
  if (search) search.value = '';
  if (searchBox) searchBox.classList.remove('has-value');
  renderBreadcrumb(side);
  renderList(side);
  if (loading) loading.classList.remove('is-hidden');
  if (listEl) listEl.classList.add('is-hidden');

  if (side === 'usb' && !activeDrive) {
    if (loading) loading.classList.add('is-hidden');
    renderList('usb');
    return;
  }

  const payload = side === 'local'
    ? { side: 'local', rootId: localRootId, rel }
    : { side: 'usb', drive: activeDrive ? activeDrive.letter : '', rel };
  try {
    const result = await api.usbList(payload);
    if (seq !== requestSeq[side]) return;
    if (loading) loading.classList.add('is-hidden');
    if (!result || !result.ok) {
      if (result && result.code === 'DRIVE_GONE') {
        activeDrive = null;
        renderList('usb');
        updateDrivePill();
        toast({ type: 'warning', message: 'U 盘已被拔出，请重新插入。', duration: 5000 });
        return;
      }
      toast({ type: 'error', message: (result && result.message) || '读取文件夹失败', duration: 6000 });
      if (side === 'local') localItems = []; else usbItems = [];
      renderList(side);
      return;
    }
    if (side === 'local') localItems = Array.isArray(result.items) ? result.items : [];
    else usbItems = Array.isArray(result.items) ? result.items : [];
    renderList(side);
    if (listEl) listEl.scrollTop = 0;
  } catch (err) {
    if (seq !== requestSeq[side]) return;
    if (loading) loading.classList.add('is-hidden');
    toast({ type: 'error', message: `读取文件夹失败：${err.message}`, duration: 6000 });
  }
}

/* ---------------- 交互 ---------------- */

function bindPaneEvents(side) {
  const listEl = side === 'local' ? dom.localList : dom.usbList;
  if (listEl) {
    listEl.addEventListener('click', (event) => {
      const row = event.target.closest('.usb-row');
      if (!row) return;
      if (row.dataset.side !== side) return;
      const rel = row.dataset.rel || '';
      const item = findItem(side, rel);
      if (!item) return;
      if (item.isdir) {
        loadDir(side, rel);
      } else {
        if (selection[side].has(rel)) selection[side].delete(rel);
        else selection[side].add(rel);
        syncRowSelection(side);
      }
    });
    listEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.usb-row');
      if (!row || row.dataset.side !== side) return;
      event.preventDefault();
      row.click();
    });
  }

  const upBtn = side === 'local' ? dom.localUp : dom.usbUp;
  if (upBtn) {
    upBtn.addEventListener('click', () => {
      const rel = side === 'local' ? localRel : usbRel;
      if (!rel) return;
      loadDir(side, parentRel(rel));
    });
  }

  const search = side === 'local' ? dom.localSearch : dom.usbSearch;
  const searchClear = side === 'local' ? dom.localSearchClear : dom.usbSearchClear;
  if (search) {
    const box = search.closest('.search-box');
    search.addEventListener('input', () => {
      if (side === 'local') filterLocal = search.value; else filterUsb = search.value;
      if (box) box.classList.toggle('has-value', Boolean(search.value));
      renderList(side);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        search.value = '';
        if (side === 'local') filterLocal = ''; else filterUsb = '';
        if (box) box.classList.remove('has-value');
        renderList(side);
      }
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (search) search.value = '';
      if (side === 'local') filterLocal = ''; else filterUsb = '';
      const box = searchClear.closest('.search-box');
      if (box) box.classList.remove('has-value');
      renderList(side);
      if (search) search.focus();
    });
  }

  const allBtn = side === 'local' ? dom.localAll : dom.usbAll;
  if (allBtn) {
    allBtn.addEventListener('click', () => {
      const items = side === 'local' ? localItems : usbItems;
      const needle = (side === 'local' ? filterLocal : filterUsb).trim().toLowerCase();
      const files = items.filter((i) => !i.isdir && (!needle || String(i.name).toLowerCase().includes(needle)));
      if (!files.length) return;
      const allSelected = files.every((f) => selection[side].has(f.rel));
      if (allSelected) {
        files.forEach((f) => selection[side].delete(f.rel));
        allBtn.classList.remove('is-active');
      } else {
        files.forEach((f) => selection[side].add(f.rel));
      }
      allBtn.textContent = allSelected ? '全选' : '取消全选';
      syncRowSelection(side);
    });
  }

  const clearBtn = side === 'local' ? dom.localClear : dom.usbClear;
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selection[side].clear();
      if (allBtn) allBtn.textContent = '全选';
      syncRowSelection(side);
    });
  }
}

/* ---------------- 拷贝 ---------------- */

function showProgress(payload) {
  if (!dom.progress) return;
  dom.progress.classList.remove('is-hidden');
  if (dom.progressName) dom.progressName.textContent = payload.name || '正在拷贝…';
  if (dom.progressMeta) dom.progressMeta.textContent = `${payload.index || 0} / ${payload.count || 0}`;
  const percent = payload.totalBytes
    ? Math.max(0, Math.min(100, Math.round((payload.doneBytes / payload.totalBytes) * 100)))
    : 0;
  if (dom.progressFill) dom.progressFill.style.width = `${percent}%`;
  if (dom.progressPercent) dom.progressPercent.textContent = `${percent}%`;
  if (dom.progressDetail) {
    dom.progressDetail.textContent = `${formatBytes(payload.doneBytes)} / ${formatBytes(payload.totalBytes)}`
      + (payload.speed ? ` · ${formatSpeed(payload.speed)}` : '');
  }
}

function hideProgress() {
  if (dom.progress) dom.progress.classList.add('is-hidden');
}

async function startCopy(direction) {
  if (copying) return;
  const sourceSide = direction === 'to-usb' ? 'local' : 'usb';
  const files = selectedFiles(sourceSide);
  if (!files.length) {
    toast({ type: 'info', message: '请先勾选要拷贝的文件。', duration: 3200 });
    return;
  }
  if (direction === 'to-usb' && !activeDrive) {
    toast({ type: 'warning', message: '未检测到 U 盘。', duration: 4000 });
    return;
  }
  const payload = {
    direction,
    drive: activeDrive ? activeDrive.letter : '',
    // v1.5：拷入本机的文件固定去向「桌面」；主进程同样强制桌面，双保险。
    rootId: direction === 'to-local' ? 'desktop' : localRootId,
    destRel: direction === 'to-usb' ? usbRel : '',
    items: files.map((f) => ({ name: f.name, rel: f.rel, size: f.size })),
  };
  copying = true;
  updateCopyButtons();
  showProgress({
    name: files[0].name,
    index: 0,
    count: files.length,
    doneBytes: 0,
    totalBytes: files.reduce((s, f) => s + (Number(f.size) || 0), 0),
  });
  try {
    const result = await api.usbCopy(payload);
    if (!result || !result.ok) {
      copying = false;
      hideProgress();
      updateCopyButtons();
      toast({ type: 'error', message: (result && result.message) || '无法开始拷贝', duration: 6000 });
    }
  } catch (err) {
    copying = false;
    hideProgress();
    updateCopyButtons();
    toast({ type: 'error', message: `拷贝失败：${err.message}`, duration: 6000 });
  }
}

function onCopyDone(payload) {
  copying = false;
  copyId = 0;
  hideProgressSoon();
  updateCopyButtons();
  if (!payload) return;
  const direction = payload.direction === 'to-local' ? 'to-local' : 'to-usb';
  if (payload.cancelled) {
    toast({ type: 'info', message: '拷贝已取消。', duration: 3200 });
  } else if (payload.ok) {
    toast({
      type: 'success',
      message: `拷贝完成：${payload.copied} 个文件 · ${formatBytes(payload.totalBytes || 0)}`,
      duration: 4200,
    });
  } else if (payload.message) {
    toast({ type: 'error', message: payload.message, duration: 7000 });
  } else {
    toast({
      type: 'warning',
      message: `完成 ${payload.copied || 0} 个，失败 ${payload.failedCount || 0} 个。`,
      duration: 6000,
    });
  }
  const destSide = direction === 'to-usb' ? 'usb' : 'local';
  const sourceSide = direction === 'to-usb' ? 'local' : 'usb';
  selection[sourceSide].clear();
  syncRowSelection(sourceSide);
  loadDir(destSide, destSide === 'usb' ? usbRel : localRel);
}

let hideTimer = null;
function hideProgressSoon() {
  if (hideTimer) clearTimeout(hideTimer);
  if (dom.progressFill) dom.progressFill.style.width = '100%';
  hideTimer = setTimeout(() => hideProgress(), 900);
}

function subscribeProgress() {
  api.onUsbCopyProgress((payload) => {
    if (!payload || !copying) return;
    if (payload.id) copyId = payload.id;
    showProgress(payload);
  });
  api.onUsbCopyDone((payload) => {
    onCopyDone(payload);
  });
}

/* ---------------- U 盘插拔 ---------------- */

export function usbDrivesChanged(drives) {
  const list = Array.isArray(drives) ? drives : [];
  const previous = activeDrive ? activeDrive.letter : '';
  activeDrive = list.find((d) => d.letter === previous) || list[0] || null;
  if (pageOpen) {
    updateDrivePill();
    updatePaneMeta('usb');
    if (activeDrive) {
      loadDir('usb', usbRel);
    } else {
      usbItems = [];
      selection.usb.clear();
      renderBreadcrumb('usb');
      renderList('usb');
    }
  }
}

/* ---------------- v1.8.0 多 U 盘选择对话框 ---------------- */

function driveCardHtml(drive) {
  const label = drive.label ? String(drive.label).trim() : '';
  const size = Number(drive.size) || 0;
  const free = Number(drive.free) || 0;
  const used = size > 0 ? Math.max(0, size - free) : 0;
  const usedPct = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
  const meta = [
    drive.fs ? String(drive.fs).toUpperCase() : '可移动磁盘',
    size ? `共 ${formatBytes(size)}` : '',
    free ? `剩余 ${formatBytes(free)}` : '剩余未知',
  ].filter(Boolean).join(' · ');
  const name = `${drive.letter}${label ? ` ${label}` : ''}`;
  return `
    <button class="drive-card" type="button" data-letter="${escapeHtml(drive.letter)}">
      <span class="drive-glyph">${ICON.usb}</span>
      <span class="drive-info">
        <span class="drive-name">${escapeHtml(name)}</span>
        <span class="drive-meta">${escapeHtml(meta)}</span>
        <span class="drive-cap" aria-hidden="true"><i style="width:${usedPct}%"></i></span>
        <span class="drive-cap-text">${usedPct}% 已用</span>
      </span>
    </button>`;
}

/**
 * 多 U 盘选择对话框：纯渲染进程内的 div（#modal-layer 内），走应用统一的玻璃面板
 * 设计语言，不使用任何浏览器原生弹窗。返回选中的 drive 对象；取消 / Esc 返回 null。
 * 盘名（含中日韩字符）经 escapeHtml 转义后直接展示，无编码损失。
 */
async function pickUsbDrive({ title, message } = {}) {
  const drives = Array.isArray(state.usbDrives) ? state.usbDrives : [];
  if (drives.length <= 1) return drives[0] || null;
  const chosen = await openModal({
    title: title || '选择 U 盘',
    message: message || '检测到多个移动存储设备，请选择要使用的设备。',
    icon: 'usb',
    content: `<div class="drive-picker">${drives.map(driveCardHtml).join('')}</div>`,
    onMount: (box, finish) => {
      box.querySelectorAll('.drive-card').forEach((card) => {
        card.addEventListener('click', () => finish(card.dataset.letter));
      });
    },
    actions: [{ label: '取消', value: null }],
  });
  if (!chosen) return null;
  return drives.find((d) => d.letter === chosen) || null;
}

async function chooseDrive() {
  const drives = Array.isArray(state.usbDrives) ? state.usbDrives : [];
  if (drives.length <= 1) return;
  const chosen = await pickUsbDrive({
    title: '切换 U 盘',
    message: '请选择要查看的移动存储设备。',
  });
  if (!chosen) return;
  activeDrive = chosen;
  usbRel = '';
  updateDrivePill();
  updatePaneMeta('usb');
  loadDir('usb', '');
}

/* ---------------- 打开 / 关闭 ---------------- */

export async function openUsbBrowser({ drive = null } = {}) {
  if (!dom.page) return false;
  const drives = Array.isArray(state.usbDrives) ? state.usbDrives : [];
  // v1.8.0：插着多个 U 盘时，先在渲染进程内弹出「选择 U 盘」对话框，
  // 用户选中后才进入文件列表；取消则不进入页面。
  let target = drive;
  if (!target && drives.length > 1) {
    target = await pickUsbDrive({
      title: '选择 U 盘',
      message: '检测到多个移动存储设备，请选择要打开的设备。',
    });
    if (!target) return false;
  }
  activeDrive = target
    || drives.find((d) => d.letter === (activeDrive && activeDrive.letter))
    || drives[0]
    || null;
  pageOpen = true;
  state.page = 'usb';
  document.body.classList.add('files-open');
  dom.page.classList.add('is-open');
  dom.page.setAttribute('aria-hidden', 'false');
  localRel = '';
  usbRel = '';
  selection.local.clear();
  selection.usb.clear();
  filterLocal = '';
  filterUsb = '';
  renderRoots();
  updateDrivePill();
  loadDir('local', '');
  loadDir('usb', '');
  if (dom.localSearch) setTimeout(() => dom.localSearch.blur(), 60);
  if (dom.usbSearch) setTimeout(() => dom.usbSearch.blur(), 60);
  return true;
}

export function closeUsbBrowser() {
  pageOpen = false;
  state.page = 'home';
  if (dom.page) {
    dom.page.classList.remove('is-open');
    dom.page.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('files-open');
  if (hooks.onClose) hooks.onClose();
}

export function isUsbBrowserOpen() {
  return pageOpen;
}

export function initUsbBrowser(options = {}) {
  hooks = options;
  dom = {
    page: $('#usb-page'),
    back: $('#usb-back'),
    refresh: $('#usb-refresh'),
    subtitle: $('#usb-subtitle'),
    devicePill: $('#usb-device-pill'),
    deviceText: $('#usb-device-text'),
    localRoots: $('#usb-local-roots'),
    localTitle: $('#usb-local-title'),
    localUp: $('#usb-local-up'),
    localCrumbs: $('#usb-local-crumbs'),
    localSearch: $('#usb-local-search'),
    localSearchClear: $('#usb-local-search-clear'),
    localSearchIcon: $('#usb-local-search-icon'),
    localList: $('#usb-local-list'),
    localLoading: $('#usb-local-loading'),
    localEmpty: $('#usb-local-empty'),
    localEmptyIcon: $('#usb-local-empty-icon'),
    localInfo: $('#usb-local-info'),
    localAll: $('#usb-local-all'),
    localClear: $('#usb-local-clear'),
    copyToUsb: $('#usb-copy-to-usb'),
    usbTitle: $('#usb-usb-title'),
    usbFree: $('#usb-free'),
    usbUp: $('#usb-usb-up'),
    usbCrumbs: $('#usb-usb-crumbs'),
    usbSearch: $('#usb-usb-search'),
    usbSearchClear: $('#usb-usb-search-clear'),
    usbSearchIcon: $('#usb-usb-search-icon'),
    usbList: $('#usb-usb-list'),
    usbLoading: $('#usb-usb-loading'),
    usbEmpty: $('#usb-usb-empty'),
    usbEmptyIcon: $('#usb-usb-empty-icon'),
    usbMissing: $('#usb-usb-missing'),
    usbMissingIcon: $('#usb-usb-missing-icon'),
    usbInfo: $('#usb-usb-info'),
    usbAll: $('#usb-usb-all'),
    usbClear: $('#usb-usb-clear'),
    copyToLocal: $('#usb-copy-to-local'),
    progress: $('#usb-progress'),
    progressName: $('#usb-progress-name'),
    progressMeta: $('#usb-progress-meta'),
    progressFill: $('#usb-progress-fill'),
    progressPercent: $('#usb-progress-percent'),
    progressDetail: $('#usb-progress-detail'),
    progressCancel: $('#usb-progress-cancel'),
  };
  if (!dom.page) return;

  setIcon(dom.back, 'arrowLeft');
  setIcon(dom.refresh, 'refresh');
  setIcon(dom.localUp, 'arrowUp');
  setIcon(dom.usbUp, 'arrowUp');
  setIcon(dom.localSearchIcon, 'search');
  setIcon(dom.usbSearchIcon, 'search');
  setIcon(dom.localEmptyIcon, 'folderOpen');
  setIcon(dom.usbEmptyIcon, 'usb');
  setIcon(dom.usbMissingIcon, 'usb');

  if (dom.back) dom.back.addEventListener('click', () => closeUsbBrowser());
  if (dom.refresh) {
    dom.refresh.addEventListener('click', async () => {
      try {
        const result = await api.usbDrives();
        if (result && Array.isArray(result.drives)) {
          state.usbDrives = result.drives;
          usbDrivesChanged(result.drives);
        }
        loadDir('local', localRel);
        loadDir('usb', usbRel);
      } catch (_) { /* ignore */ }
    });
  }
  if (dom.devicePill) {
    dom.devicePill.addEventListener('click', () => chooseDrive());
  }
  if (dom.localRoots) {
    dom.localRoots.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-root]');
      if (!button || button.dataset.root === localRootId) return;
      localRootId = button.dataset.root === 'desktop' ? 'desktop' : 'downloads';
      localRootLabel = localRootId === 'desktop' ? '桌面' : '下载文件夹';
      renderRoots();
      loadDir('local', '');
    });
  }
  if (dom.copyToUsb) dom.copyToUsb.addEventListener('click', () => startCopy('to-usb'));
  if (dom.copyToLocal) dom.copyToLocal.addEventListener('click', () => startCopy('to-local'));
  if (dom.progressCancel) {
    dom.progressCancel.addEventListener('click', async () => {
      try {
        const result = await api.usbCopyCancel(copyId || undefined);
        if (result && result.ok === false && result.message) {
          toast({ type: 'info', message: result.message, duration: 2600 });
        }
      } catch (_) { /* ignore */ }
    });
  }

  bindPaneEvents('local');
  bindPaneEvents('usb');
  subscribeProgress();
  renderRoots();
  updateDrivePill();
}
