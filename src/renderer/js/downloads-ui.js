import api from './api.js';
import { state } from './state.js';
import { $, escapeHtml, formatBytes, formatSpeed, toast } from './ui.js';

let tray = null;
let items = null;
let hideTimer = null;
let userHidden = false;

function ensureRefs() {
  tray = document.getElementById('download-tray');
  items = state.downloadItems;
}

function percentOf(item) {
  if (!item.total || item.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((item.received / item.total) * 100)));
}

function render() {
  if (!tray) return;
  const list = Array.from(items.values()).filter(Boolean);
  if (!list.length) {
    tray.classList.add('is-hidden');
    tray.innerHTML = '';
    return;
  }
  if (userHidden) {
    tray.classList.add('is-hidden');
    return;
  }

  const activeCount = list.filter((item) => item.status !== 'done' && item.status !== 'error').length;
  const title = activeCount > 0 ? `正在下载 · ${activeCount}` : '下载完成';
  tray.classList.remove('is-hidden');
  tray.innerHTML = `
    <div class="tray-head">
      <span>${title}</span>
      <button class="tray-close" type="button">收起</button>
    </div>
    <div class="tray-items">
      ${list.slice(0, 3).map((item) => {
        const percent = percentOf(item);
        const barClass = item.status === 'queued' ? 'indeterminate' : '';
        const width = item.status === 'queued' ? 0 : (percent == null ? (item.status === 'done' ? 100 : 12) : percent);
        const statusText = item.status === 'queued'
          ? '排队中'
          : item.status === 'fallback'
            ? '切换共享盘…'
            : item.status === 'done'
              ? '完成'
              : item.status === 'error'
                ? '失败'
                : percent != null
                  ? `${percent}%`
                  : formatBytes(item.received || 0);
        const sub = item.status === 'error'
          ? (item.message || '下载失败')
          : item.status === 'done'
            ? '轻触打开文件'
            : [
              item.method === 'smb' ? '共享盘通道' : 'FileStation',
              item.total ? `${formatBytes(item.received || 0)} / ${formatBytes(item.total)}` : '',
              item.speed ? formatSpeed(item.speed) : '',
            ].filter(Boolean).join(' · ');
        return `
          <div class="tray-item ${item.status === 'done' ? 'done' : ''} ${item.status === 'error' ? 'failed' : ''}" data-id="${item.id}" ${item.status === 'done' ? 'role="button" tabindex="0"' : ''}>
            <div class="tray-item-top">
              <span class="tray-item-name">${escapeHtml(item.name || '课件')}</span>
              <span class="tray-item-status">${statusText}</span>
            </div>
            <div class="tray-bar"><i class="${barClass}" style="width:${width}%"></i></div>
            <div class="tray-item-sub">${escapeHtml(sub)}</div>
          </div>
        `;
      }).join('')}
      ${list.length > 3 ? `<div class="tray-item-sub" style="padding-top:6px;text-align:center">还有 ${list.length - 3} 个下载任务</div>` : ''}
    </div>
  `;
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const list = Array.from(items.values());
    const allFinished = list.length && list.every((item) => item.status === 'done' || item.status === 'error');
    if (allFinished) {
      items.clear();
      userHidden = false;
      render();
    }
  }, 6500);
}

function upsert(payload, patch) {
  if (!payload || !payload.id) return null;
  const existing = items.get(payload.id) || {
    id: payload.id,
    name: payload.name || '课件',
    received: 0,
    total: 0,
    status: 'queued',
    method: '',
    lastReceived: 0,
    lastAt: 0,
    speed: 0,
  };
  const next = { ...existing, ...payload, ...patch };
  items.set(next.id, next);
  return next;
}

export function initDownloadsUI() {
  ensureRefs();
  if (!tray) return;
  state.downloadItems.clear();

  api.onDownloadQueued((payload) => {
    userHidden = false;
    upsert(payload, { status: 'queued' });
    render();
  });

  api.onDownloadStart((payload) => {
    userHidden = false;
    const item = upsert(payload, {
      status: 'downloading',
      received: 0,
      total: payload.size || 0,
      method: 'file-station',
      startedAt: Date.now(),
      lastAt: Date.now(),
    });
    if (item) item.speed = 0;
    render();
  });

  api.onDownloadProgress((payload) => {
    const item = items.get(payload.id);
    if (!item) return;
    const now = Date.now();
    const elapsed = (now - (item.lastAt || now)) / 1000;
    if (elapsed >= 0.35 && payload.received > (item.lastReceived || 0)) {
      item.speed = (payload.received - item.lastReceived) / elapsed;
      item.lastReceived = payload.received;
      item.lastAt = now;
    }
    item.received = payload.received;
    if (payload.total) item.total = payload.total;
    item.method = payload.method || item.method;
    item.status = 'downloading';
    render();
  });

  api.onDownloadFallback((payload) => {
    const item = items.get(payload.id);
    if (item) {
      item.status = 'fallback';
      item.method = 'smb';
      render();
    }
    toast({ type: 'warning', message: 'NAS 下载接口不可用，正在改用共享盘通道…', duration: 4200 });
  });

  api.onDownloadComplete((payload) => {
    const item = items.get(payload.id) || upsert(payload, {});
    if (!item) return;
    item.status = 'done';
    item.received = payload.size || item.total || item.received;
    item.total = payload.size || item.total;
    item.path = payload.path;
    item.method = payload.method || item.method;
    render();
    scheduleHide();
  });

  api.onDownloadError((payload) => {
    const item = items.get(payload.id) || upsert(payload, {});
    if (!item) return;
    item.status = 'error';
    item.message = payload.message || '下载失败';
    render();
    toast({ type: 'error', message: item.message, duration: 7000 });
    scheduleHide();
  });

  tray.addEventListener('click', (event) => {
    const close = event.target.closest('.tray-close');
    if (close) {
      userHidden = true;
      render();
      return;
    }
    const row = event.target.closest('.tray-item.done');
    if (row) {
      const item = items.get(row.dataset.id);
      if (item && item.path) {
        api.openDownloadFile(item.path).then((result) => {
          if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开文件' });
        }).catch(() => {});
      }
    }
  });

  tray.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.tray-item.done');
    if (row) {
      event.preventDefault();
      row.click();
    }
  });
}

export function resetDownloadTray() {
  ensureRefs();
  if (!items) return;
  items.clear();
  userHidden = false;
  render();
}
