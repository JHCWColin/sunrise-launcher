'use strict';

/**
 * 移动存储设备（U 盘）模块：
 *  - 轮询 Windows 可移动磁盘（Win32_LogicalDisk DriveType=2），变化时广播 usb:drives
 *  - 列举本机课件（下载文件夹 / 桌面，仅课程类资源，子文件夹进入次级界面）
 *  - 列举 U 盘全部文件
 *  - 双向拷贝（流式 + 字节级进度事件 usb:copy-progress / usb:copy-done，可取消）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const {
  VIDEO_EXTS,
  PRESENTATION_EXTS,
  DOCUMENT_EXTS,
  SHEET_EXTS,
  PDF_EXTS,
  IMAGE_EXTS,
  AUDIO_EXTS,
  ARCHIVE_EXTS,
  COURSEWARE_EXTS,
} = require('./constants');
const store = require('./store');
const log = require('./logger');

const POLL_INTERVAL = 4000;
const PS_TIMEOUT = 6000;
const PART_SUFFIX = '.sunrise-part';
const PROGRESS_INTERVAL = 140; // ms，进度事件节流

const COURSE_EXTS = new Set([
  ...VIDEO_EXTS, ...PRESENTATION_EXTS, ...DOCUMENT_EXTS, ...SHEET_EXTS,
  ...PDF_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS, ...ARCHIVE_EXTS, ...COURSEWARE_EXTS,
]);

const IGNORED_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '$recycle.bin', 'system volume information', 'recycled', 'recycler']);

const ROOT_IDS = { downloads: true, desktop: true };

let pollTimer = null;
let polling = false;
let knownKey = '';
let sendFn = () => {};
let drivesCache = [];
let copySeq = 0;
let activeCopy = null;
let autoOpenFile = () => ({ ok: false }); // 由 ipc.js 注入 ctx.openDownloaded

/* ---------------- 基础工具 ---------------- */

function psExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/* 盘符对应的根目录：Windows 下为 "E:\"，非 Windows（开发/测试）下为 cwd 下同名目录。 */
function driveRootPath(letter) {
  return process.platform === 'win32'
    ? `${letter}\\`
    : path.join(process.cwd(), letter);
}

function isIgnoredName(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (lower.startsWith('.') || lower.startsWith('~$')) return true;
  if (IGNORED_NAMES.has(lower)) return true;
  if (lower.endsWith(PART_SUFFIX) || lower.endsWith('.tmp') || lower.endsWith('.part')) return true;
  return false;
}

function sanitizeFileName(name) {
  let base = String(name || 'file')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!base) base = 'file';
  if (base.length > 150) {
    const ext = path.extname(base).slice(0, 12);
    base = `${base.slice(0, 150 - ext.length)}${ext}`;
  }
  return base;
}

function uniqueDestination(dir, name) {
  const clean = sanitizeFileName(name);
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  let candidate = path.join(dir, clean);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${index})${ext}`);
    index += 1;
    if (index > 999) break;
  }
  return candidate;
}

function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeJoin(root, rel) {
  const clean = String(rel || '').replace(/^[\\/]+/, '');
  const target = path.resolve(path.join(root, clean));
  if (!inside(root, target)) return null;
  return target;
}

function extLower(name) {
  return path.extname(name || '').replace('.', '').toLowerCase();
}

function sortEntries(items) {
  const coll = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  return items.sort((a, b) => {
    if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
    return coll(a.name, b.name);
  });
}

/* ---------------- U 盘检测 ---------------- */

function queryDrives() {
  return new Promise((resolve) => {
    // 开发调试用：SUNRISE_USB_FAKE_DRIVES='[{"letter":"E:","label":"TEST","fs":"exFAT","size":...,"free":...}]'
    if (process.env.SUNRISE_USB_FAKE_DRIVES) {
      try {
        const fake = JSON.parse(process.env.SUNRISE_USB_FAKE_DRIVES);
        resolve(Array.isArray(fake) ? fake : []);
      } catch (_) {
        resolve([]);
      }
      return;
    }
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    // v1.8.0：强制 PowerShell 以 UTF-8 输出，保证中日韩（CJK）卷标不被
    // 中文系统默认的 GBK 控制台编码转成乱码（英文系统则会直接丢成问号）。
    const command = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
      + 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" '
      + '| Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace '
      + '| ConvertTo-Json -Compress';
    let child;
    try {
      child = spawn(psExe(), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden', '-Command', command,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      log.warn('启动 PowerShell 查询 U 盘失败:', err.message);
      resolve([]);
      return;
    }
    let out = '';
    let errText = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
      finish([]);
    }, PS_TIMEOUT);
    child.stdout.on('data', (buf) => { out += buf.toString('utf8'); }); // 已是 UTF-8 字节流
    child.stderr.on('data', (buf) => { errText += buf.toString('utf8'); });
    child.on('error', () => finish([]));
    child.on('close', () => {
      try {
        // 去掉 UTF-8 BOM（个别环境下 PowerShell 首个数据块会带 \uFEFF）。
        const text = out.replace(/^\uFEFF/, '').trim();
        if (!text || text === 'null') {
          finish([]);
          return;
        }
        let raw = JSON.parse(text);
        if (!Array.isArray(raw)) raw = [raw];
        const drives = raw
          .filter((d) => d && d.DeviceID && Number(d.Size) > 0)
          .map((d) => ({
            letter: String(d.DeviceID).toUpperCase(),
            // 卷标按原样保留（中文/日文/韩文均可），只清掉控制字符。
            label: String(d.VolumeName || '').replace(/[\u0000-\u001f]/g, '').trim(),
            fs: String(d.FileSystem || '').trim(),
            size: Number(d.Size) || 0,
            free: Number(d.FreeSpace) || 0,
          }))
          .filter((d) => /^[A-Z]:$/.test(d.letter));
        finish(drives);
      } catch (err) {
        if (errText.trim()) log.warn('查询 U 盘失败:', errText.trim().slice(0, 300));
        else log.warn('解析 U 盘列表失败:', err.message);
        finish([]);
      }
    });
  });
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  const drives = await queryDrives();
  polling = false;
  drivesCache = drives;
  const key = drives.map((d) => `${d.letter}:${d.size}`).join('|');
  if (key !== knownKey) {
    const previous = knownKey;
    knownKey = key;
    log.info(`移动存储设备变化: [${previous}] -> [${key || '无'}]`);
    try {
      sendFn('usb:drives', { drives, count: drives.length });
    } catch (_) { /* ignore */ }
  }
}

function startMonitor(send) {
  sendFn = send || (() => {});
  stopMonitor();
  pollOnce();
  pollTimer = setInterval(() => {
    pollOnce().catch(() => {});
  }, POLL_INTERVAL);
  log.info('U 盘监测已启动（每 4 秒轮询一次可移动磁盘）');
}

function stopMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function refreshNow() {
  return pollOnce().then(() => drivesCache);
}

/* ---------------- 本机根目录 ---------------- */

function localRoots() {
  const config = store.get();
  const roots = [];
  try {
    const downloads = store.ensureDownloadDir(config);
    roots.push({ id: 'downloads', label: '下载文件夹', path: downloads });
  } catch (_) { /* ignore */ }
  try {
    roots.push({ id: 'desktop', label: '桌面', path: app.getPath('desktop') });
  } catch (_) { /* ignore */ }
  return roots;
}

function rootById(rootId) {
  return localRoots().find((r) => r.id === rootId) || null;
}

/* ---------------- 目录列举 ---------------- */

async function listLocal(rootId, rel) {
  const root = rootById(rootId);
  if (!root) return { ok: false, message: '未知的本机位置' };
  const dir = safeJoin(root.path, rel);
  if (!dir) return { ok: false, message: '无效的路径' };
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return { ok: false, message: `无法读取文件夹：${err.message}` };
  }
  const items = [];
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      items.push({
        name: entry.name,
        rel: path.relative(root.path, full).replace(/\\/g, '/'),
        isdir: true,
        size: 0,
        mtime: 0,
      });
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      const ext = extLower(entry.name);
      if (!COURSE_EXTS.has(ext)) continue; // 本机侧只显示课程类资源
      let stat;
      try { stat = await fs.promises.stat(full); } catch (_) { continue; }
      items.push({
        name: entry.name,
        rel: path.relative(root.path, full).replace(/\\/g, '/'),
        isdir: false,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }
  return {
    ok: true,
    side: 'local',
    root: { id: root.id, label: root.label },
    rel: path.relative(root.path, dir).replace(/\\/g, '/') || '',
    items: sortEntries(items),
  };
}

async function listUsb(letter, rel) {
  const drive = drivesCache.find((d) => d.letter === letter);
  if (!drive) return { ok: false, message: '未检测到该 U 盘，可能已被拔出', code: 'DRIVE_GONE' };
  const rootPath = driveRootPath(drive.letter);
  const dir = safeJoin(rootPath, rel);
  if (!dir) return { ok: false, message: '无效的路径' };
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const gone = !fs.existsSync(rootPath);
    return {
      ok: false,
      message: gone ? 'U 盘已被拔出' : `无法读取 U 盘文件夹：${err.message}`,
      code: gone ? 'DRIVE_GONE' : 'LIST_FAILED',
    };
  }
  const items = [];
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      items.push({
        name: entry.name,
        rel: path.relative(rootPath, full).replace(/\\/g, '/'),
        isdir: true,
        size: 0,
        mtime: 0,
      });
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      let stat;
      try { stat = await fs.promises.stat(full); } catch (_) { continue; }
      items.push({
        name: entry.name,
        rel: path.relative(rootPath, full).replace(/\\/g, '/'),
        isdir: false,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }
  return {
    ok: true,
    side: 'usb',
    root: { id: drive.letter, label: drive.label || '可移动磁盘' },
    rel: path.relative(rootPath, dir).replace(/\\/g, '/') || '',
    items: sortEntries(items),
  };
}

/* ---------------- 拷贝（流式 + 进度 + 取消） ---------------- */

function resolveCopyPaths(payload) {
  const direction = payload.direction === 'to-local' ? 'to-local' : 'to-usb';
  const items = Array.isArray(payload.items)
    ? payload.items.filter((i) => i && typeof i.rel === 'string' && !i.isdir)
    : [];
  if (!items.length) return { error: '没有选择要拷贝的文件' };

  let srcRootPath;
  let destDir;
  if (direction === 'to-usb') {
    const drive = drivesCache.find((d) => d.letter === payload.drive);
    if (!drive) return { error: '未检测到 U 盘，可能已被拔出' };
    srcRootPath = rootById(payload.rootId || 'downloads');
    if (!srcRootPath) return { error: '未知的本机位置' };
    srcRootPath = srcRootPath.path;
    destDir = safeJoin(driveRootPath(drive.letter), payload.destRel);
    if (!destDir) return { error: '无效的 U 盘目标路径' };
    if (!fs.existsSync(destDir)) return { error: 'U 盘目标文件夹不存在' };
  } else {
    // v1.5：从 U 盘拷入本机时，目标固定为「桌面」，不再跟随左侧当前浏览的文件夹。
    const drive = drivesCache.find((d) => d.letter === payload.drive);
    if (!drive) return { error: '未检测到 U 盘，可能已被拔出' };
    srcRootPath = driveRootPath(drive.letter);
    try {
      destDir = app.getPath('desktop');
    } catch (_) {
      const fallback = rootById('desktop');
      if (!fallback) return { error: '无法定位桌面目录' };
      destDir = fallback.path;
    }
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      return { error: `无法访问桌面文件夹：${err.message}` };
    }
  }

  const files = [];
  let totalBytes = 0;
  for (const item of items) {
    const src = safeJoin(srcRootPath, item.rel);
    if (!src) continue;
    let stat;
    try { stat = fs.statSync(src); } catch (_) { continue; }
    if (!stat.isFile()) continue;
    files.push({ name: path.basename(src), src, size: stat.size });
    totalBytes += stat.size;
  }
  if (!files.length) return { error: '要拷贝的文件已不存在' };
  return { direction, files, destDir, totalBytes };
}

function copyOneFile(src, destDir, name, onBytes, onRegisterAbort) {
  return new Promise((resolve, reject) => {
    let dest;
    try {
      dest = uniqueDestination(destDir, name);
    } catch (err) {
      reject(err);
      return;
    }
    const part = `${dest}${PART_SUFFIX}`;
    let readStream;
    let writeStream;
    let settled = false;
    const cleanup = (err) => {
      if (settled) return;
      settled = true;
      try { if (readStream) readStream.destroy(); } catch (_) { /* ignore */ }
      try { if (writeStream) writeStream.destroy(); } catch (_) { /* ignore */ }
      try { fs.rmSync(part, { force: true }); } catch (_) { /* ignore */ }
      if (err) reject(err);
    };
    try {
      readStream = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 });
      writeStream = fs.createWriteStream(part, { highWaterMark: 4 * 1024 * 1024 });
    } catch (err) {
      cleanup(err);
      return;
    }
    if (onRegisterAbort) {
      // 取消时销毁两个流：writeStream 的 close 会触发 cleanup，删除半成品文件。
      onRegisterAbort(() => {
        try { readStream.destroy(); } catch (_) { /* ignore */ }
        try { writeStream.destroy(); } catch (_) { /* ignore */ }
      });
    }
    readStream.on('data', (chunk) => {
      onBytes(chunk.length);
      // 手动转发 + 背压：写入端拥堵时暂停读取，避免大文件占满内存。
      if (!writeStream.write(chunk)) readStream.pause();
    });
    writeStream.on('drain', () => readStream.resume());
    readStream.on('end', () => writeStream.end());
    readStream.on('error', cleanup);
    writeStream.on('error', cleanup);
    // 流被中途销毁（取消拷贝）时：清理半成品并拒绝。
    writeStream.on('close', () => { if (!settled) cleanup(new Error('已取消')); });
    writeStream.on('finish', () => {
      if (settled) return;
      settled = true;
      fs.rename(part, dest, (err) => {
        if (err) {
          try { fs.rmSync(part, { force: true }); } catch (_) { /* ignore */ }
          reject(err);
          return;
        }
        resolve(dest);
      });
    });
  });
}

async function runCopy(payload) {
  const resolved = resolveCopyPaths(payload);
  if (resolved.error) {
    sendFn('usb:copy-done', { id: 0, ok: false, cancelled: false, message: resolved.error });
    return;
  }
  const { direction, files, destDir, totalBytes } = resolved;
  const id = ++copySeq;
  const job = { id, cancelled: false, abort: null };
  activeCopy = job;

  const startedAt = Date.now();
  let doneBytes = 0;
  let lastEmit = 0;
  let speedEma = 0;
  let lastTickAt = startedAt;
  let lastTickBytes = 0;
  let copied = 0;
  const copiedFiles = []; // 拷入本机时记录最终落盘路径，用于完成后自动打开
  const failed = [];

  const emit = (force, fileIndex, fileBytes, fileTotal, fileName) => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL) return;
    lastEmit = now;
    const dt = (now - lastTickAt) / 1000;
    if (dt >= 0.25) {
      const inst = (doneBytes - lastTickBytes) / dt;
      speedEma = speedEma ? speedEma * 0.7 + inst * 0.3 : inst;
      lastTickAt = now;
      lastTickBytes = doneBytes;
    }
    sendFn('usb:copy-progress', {
      id,
      direction,
      index: fileIndex,
      count: files.length,
      name: fileName,
      fileBytes,
      fileTotal,
      doneBytes,
      totalBytes,
      speed: Math.round(speedEma),
    });
  };

  for (let i = 0; i < files.length; i += 1) {
    if (job.cancelled) break;
    const file = files[i];
    const fileIndex = i + 1;
    let fileBytes = 0;
    job.abort = null;
    emit(true, fileIndex, 0, file.size, file.name);
    try {
      const destPath = await copyOneFile(file.src, destDir, file.name, (n) => {
        fileBytes += n;
        doneBytes += n;
        emit(false, fileIndex, fileBytes, file.size, file.name);
      }, (abortFn) => { job.abort = abortFn; });
      copiedFiles.push(destPath);
      copied += 1;
      emit(true, fileIndex, file.size, file.size, file.name);
    } catch (err) {
      if (job.cancelled) break;
      failed.push({ name: file.name, message: err.message });
      log.warn(`拷贝失败: ${file.name}:`, err.message);
      // 设备被拔出等致命错误：终止整批。
      const fatal = err.code === 'ENOENT' && !fs.existsSync(destDir);
      if (fatal) {
        job.cancelled = true;
        job.fatal = err.message;
        break;
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const payloadDone = {
    id,
    ok: failed.length === 0,
    cancelled: job.cancelled === true,
    copied,
    failedCount: failed.length,
    failed,
    totalBytes: doneBytes,
    durationMs,
    direction,
  };
  if (job.fatal) payloadDone.message = job.fatal;
  if (activeCopy === job) activeCopy = null;
  try {
    sendFn('usb:copy-done', payloadDone);
  } catch (_) { /* ignore */ }
  log.info(`U 盘拷贝完成: ${direction} · 成功 ${copied} · 失败 ${failed.length} · 耗时 ${Math.round(durationMs / 100) / 10}s`);

  // v1.5：拷入本机（桌面）完成后自动打开——单个文件按类型直接打开（VLC / WPS / 内置看图…），
  // 多个文件则打开桌面文件夹，避免一次弹出十几个窗口。
  if (direction === 'to-local' && !job.cancelled && copiedFiles.length) {
    try {
      if (copiedFiles.length === 1) {
        autoOpenFile(copiedFiles[0], 'usb', true);
        log.info('已自动打开拷入桌面的文件:', copiedFiles[0]);
      } else {
        const openErr = await shell.openPath(destDir);
        if (openErr) log.warn('打开桌面文件夹失败:', openErr);
        else log.info(`已打开桌面文件夹（${copiedFiles.length} 个文件拷入）`);
      }
    } catch (err) {
      log.warn('自动打开拷入文件失败:', err.message);
    }
  }
}

function cancelCopy(id) {
  if (activeCopy && (!id || activeCopy.id === id)) {
    activeCopy.cancelled = true;
    if (activeCopy.abort) {
      try { activeCopy.abort(); } catch (_) { /* ignore */ }
    }
    return { ok: true };
  }
  return { ok: false, message: '当前没有正在进行的拷贝' };
}

/* ---------------- IPC ---------------- */

function registerUsbIpc(ipcMain, options = {}) {
  if (typeof options.autoOpenFile === 'function') autoOpenFile = options.autoOpenFile;

  ipcMain.handle('usb:drives-get', async () => {
    // 主动查询一次，保证插拔后立即拿到最新状态。
    const drives = await refreshNow();
    return { ok: true, drives };
  });

  ipcMain.handle('usb:roots', async () => ({ ok: true, roots: localRoots() }));

  ipcMain.handle('usb:list', async (event, payload) => {
    if (!payload || typeof payload !== 'object') return { ok: false, message: '无效的请求' };
    if (payload.side === 'usb') {
      return listUsb(String(payload.drive || ''), payload.rel);
    }
    const rootId = ROOT_IDS[payload.rootId] ? payload.rootId : 'downloads';
    return listLocal(rootId, payload.rel);
  });

  ipcMain.handle('usb:copy', async (event, payload) => {
    if (activeCopy) return { ok: false, message: '已有拷贝任务正在进行，请稍候或取消' };
    if (!payload || typeof payload !== 'object') return { ok: false, message: '无效的拷贝请求' };
    const resolved = resolveCopyPaths(payload);
    if (resolved.error) return { ok: false, message: resolved.error };
    runCopy(payload).catch((err) => {
      log.error('拷贝任务异常:', err.message);
      activeCopy = null;
      sendFn('usb:copy-done', { id: 0, ok: false, message: `拷贝异常：${err.message}` });
    });
    return { ok: true };
  });

  ipcMain.handle('usb:copy-cancel', async (event, id) => cancelCopy(id));
}

module.exports = {
  startMonitor,
  stopMonitor,
  refreshNow,
  registerUsbIpc,
  listLocal,
  listUsb,
};
