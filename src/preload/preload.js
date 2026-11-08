'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { callback(payload); } catch (err) {
      // 渲染进程错误由页面自己处理，这里只避免事件链中断。
      console.error(`[preload] ${channel}`, err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sunrise', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  setAutoStart: (enabled) => ipcRenderer.invoke('app:set-auto-start', enabled),

  launchApp: (key) => ipcRenderer.invoke('launch:app', key),
  launchFile: (filePath) => ipcRenderer.invoke('launch:file', filePath),

  nasList: (path) => ipcRenderer.invoke('nas:list', path),
  nasDownload: (path, name, size) => ipcRenderer.invoke('nas:download', { path, name, size }),
  nasTest: () => ipcRenderer.invoke('nas:test'),
  nasStatus: (refresh) => ipcRenderer.invoke('nas:status', Boolean(refresh)),

  openDownloadsFolder: () => ipcRenderer.invoke('downloads:open-folder'),
  chooseDownloadsFolder: () => ipcRenderer.invoke('downloads:choose-folder'),
  openDownloadFile: (filePath) => ipcRenderer.invoke('downloads:open-file', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('downloads:reveal', filePath),
  getRecent: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (filePath) => ipcRenderer.invoke('recent:remove', filePath),
  readImage: (filePath) => ipcRenderer.invoke('media:read-image', filePath),

  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  openConfigFolder: () => ipcRenderer.invoke('app:open-config-folder'),
  focusWindow: () => ipcRenderer.invoke('app:focus'),
  diagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  quit: () => ipcRenderer.invoke('app:quit'),
  clipboardWrite: (text) => ipcRenderer.invoke('app:clipboard-write', text),
  log: (level, message) => ipcRenderer.invoke('log:renderer', level, message),

  onDownloadQueued: (cb) => subscribe('download:queued', cb),
  onDownloadStart: (cb) => subscribe('download:start', cb),
  onDownloadProgress: (cb) => subscribe('download:progress', cb),
  onDownloadFallback: (cb) => subscribe('download:fallback', cb),
  onDownloadComplete: (cb) => subscribe('download:complete', cb),
  onDownloadError: (cb) => subscribe('download:error', cb),
  onRecentUpdated: (cb) => subscribe('recent:updated', cb),
  onViewerOpen: (cb) => subscribe('viewer:open', cb),
  onToast: (cb) => subscribe('toast', cb),
  onNasStatus: (cb) => subscribe('nas:status', cb),
  onCloseBlocked: (cb) => subscribe('shell:close-blocked', cb),
  onQuitting: (cb) => subscribe('shell:quitting', cb),
});
