'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { app } = require('electron');
const { NAS_USER, NAS_PASS, categoryOf, extOf, ALL_KNOWN_EXTS } = require('./constants');
const store = require('./store');
const log = require('./logger');
const { scriptsDir } = require('./taskbar');

const PART_SUFFIX = '.sunrise-part';
const IGNORED_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
const IGNORED_SUFFIXES = ['.part', '.crdownload', '.download', '.tmp', PART_SUFFIX];

function psExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function sanitizeFileName(name) {
  let base = String(name || 'download')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!base) base = 'download';
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

function isIgnoredName(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (lower.startsWith('.') || lower.startsWith('~$')) return true;
  if (IGNORED_NAMES.has(lower)) return true;
  return IGNORED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function readHead(filePath, length = 64) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function isHtmlHead(buf) {
  const text = buf.toString('utf8', 0, Math.min(buf.length, 128)).trim().toLowerCase();
  return text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<?xml')
    || text.includes('<head>') || text.includes('<body');
}

function validateDownloadedFile(filePath, ext) {
  const head = readHead(filePath, 64);
  if (!head.length) throw new Error('下载到的文件为空');
  if (isHtmlHead(head)) throw new Error('服务器返回的是网页而不是文件');
  const e = String(ext || '').toLowerCase();
  const ascii = (start, end) => head.toString('latin1', start, end);

  const zipLike = ['pptx', 'pptm', 'ppsx', 'docx', 'docm', 'xlsx', 'xlsm', 'enbx', 'enbx2', 'zip', 'jar', 'epub'];
  if (zipLike.includes(e)) {
    if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('文件格式校验失败（不是有效的 ZIP/Office 文件）');
    return true;
  }
  if (['ppt', 'doc', 'xls', 'wps', 'et', 'dps'].includes(e)) {
    if (!(head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)) {
      throw new Error('文件格式校验失败（不是有效的 Office 97-2003 文件）');
    }
    return true;
  }
  if (e === 'pdf') {
    if (ascii(0, 4) !== '%PDF') throw new Error('文件格式校验失败（不是有效的 PDF）');
    return true;
  }
  if (['jpg', 'jpeg'].includes(e)) {
    if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw new Error('文件格式校验失败（不是有效的 JPEG）');
    return true;
  }
  if (e === 'png') {
    if (!(head[0] === 0x89 && ascii(1, 4) === 'PNG')) throw new Error('文件格式校验失败（不是有效的 PNG）');
    return true;
  }
  if (e === 'gif') {
    if (!['GIF87a', 'GIF89a'].includes(ascii(0, 6))) throw new Error('文件格式校验失败（不是有效的 GIF）');
    return true;
  }
  if (e === 'bmp') {
    if (ascii(0, 2) !== 'BM') throw new Error('文件格式校验失败（不是有效的 BMP）');
    return true;
  }
  if (e === 'webp') {
    if (!(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) throw new Error('文件格式校验失败（不是有效的 WebP）');
    return true;
  }
  if (['mp4', 'mov', 'm4v', '3gp', 'm4a'].includes(e)) {
    if (ascii(4, 8) !== 'ftyp' && ascii(4, 12).trim() !== '') {
      throw new Error('文件格式校验失败（不是有效的 MP4）');
    }
    return true;
  }
  if (['mkv', 'webm'].includes(e)) {
    if (!(head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)) {
      throw new Error('文件格式校验失败（不是有效的 Matroska 视频）');
    }
    return true;
  }
  if (e === 'avi') {
    if (!(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ')) throw new Error('文件格式校验失败（不是有效的 AVI）');
    return true;
  }
  if (e === 'wmv') {
    if (!(head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2 && head[3] === 0x75)) {
      throw new Error('文件格式校验失败（不是有效的 WMV）');
    }
    return true;
  }
  if (e === 'flv') {
    if (ascii(0, 3) !== 'FLV') throw new Error('文件格式校验失败（不是有效的 FLV）');
    return true;
  }
  if (e === 'mp3') {
    if (!(ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))) {
      throw new Error('文件格式校验失败（不是有效的 MP3）');
    }
    return true;
  }
  if (e === 'wav') {
    if (!(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')) throw new Error('文件格式校验失败（不是有效的 WAV）');
    return true;
  }
  if (e === 'flac') {
    if (ascii(0, 4) !== 'fLaC') throw new Error('文件格式校验失败（不是有效的 FLAC）');
    return true;
  }
  if (e === 'ogg') {
    if (ascii(0, 4) !== 'OggS') throw new Error('文件格式校验失败（不是有效的 OGG）');
    return true;
  }
  return true;
}

function copyViaSmb({ host, user, pass, nasPath, destPart, onProgress }) {
  return new Promise((resolve, reject) => {
    const script = path.join(scriptsDir(), 'smb-copy.ps1');
    if (!fs.existsSync(script)) {
      reject(new Error('SMB 辅助脚本缺失'));
      return;
    }

    const normalized = String(nasPath).replace(/^\/+/, '').replace(/\//g, '\\');
    const remote = `\\\\${host}\\${normalized}`;
    const shareName = normalized.split('\\')[0];
    const shareRoot = `\\\\${host}\\${shareName}`;

    let total = 0;
    let lastSize = 0;
    let lastProgressAt = Date.now();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let idleTimer = null;
    let hardTimer = null;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    const child = spawn(psExe(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', script,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SUNRISE_NAS_HOST: host,
        SUNRISE_NAS_USER: user,
        SUNRISE_NAS_PASS: pass,
        SUNRISE_REMOTE_PATH: remote,
        SUNRISE_DEST_PART: destPart,
        SUNRISE_SHARE_ROOT: shareRoot,
      },
    });

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      if (err) {
        try { child.kill(); } catch (_) { /* ignore */ }
        reject(err);
      } else {
        resolve(value);
      }
    };

    const handleLine = (line) => {
      const text = line.trim();
      if (!text) return;
      if (text.startsWith('SIZE ')) {
        total = Number(text.slice(5)) || 0;
        lastProgressAt = Date.now();
        if (onProgress) onProgress(0, total);
        return;
      }
      if (text === 'OK') return;
      if (text.startsWith('ERR ')) {
        finish(new Error(text.slice(4)));
      }
    };

    child.stdout.on('data', (buf) => {
      stdoutBuffer += stdoutDecoder.write(buf);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    });
    child.stderr.on('data', (buf) => {
      stderrBuffer += stderrDecoder.write(buf);
    });
    child.on('error', (err) => finish(new Error(`SMB 进程启动失败：${err.message}`)));
    child.on('exit', (code) => {
      stdoutBuffer += stdoutDecoder.end();
      stderrBuffer += stderrDecoder.end();
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
      if (code === 0) {
        try {
          const stat = fs.statSync(destPart);
          if (stat.size <= 0) {
            finish(new Error('SMB 下载得到空文件'));
            return;
          }
          finish(null, { bytes: stat.size, method: 'smb' });
        } catch (err) {
          finish(new Error(`SMB 下载结果缺失：${err.message}`));
        }
      } else {
        const message = stderrBuffer.trim() || `SMB 复制失败（退出码 ${code}）`;
        finish(new Error(message));
      }
    });

    const resetIdle = () => {
      lastProgressAt = Date.now();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish(new Error('SMB 复制长时间无进展，已取消。'));
      }, 180000);
    };
    resetIdle();

    const poll = setInterval(() => {
      try {
        const size = fs.statSync(destPart).size;
        if (size !== lastSize) {
          lastSize = size;
          resetIdle();
          if (onProgress) onProgress(size, total);
        }
      } catch (_) { /* 文件尚未创建 */ }
      if (Date.now() - lastProgressAt > 180000) {
        finish(new Error('SMB 复制超时，已取消。'));
      }
    }, 600);

    hardTimer = setTimeout(() => {
      if (!settled) finish(new Error('SMB 复制超过 30 分钟，已取消。'));
    }, 30 * 60 * 1000);
  });
}

class DownloadManager {
  constructor({ getConfig, nas, send, onCompleted }) {
    this.getConfig = getConfig;
    this.nas = nas;
    this.send = send;
    this.onCompleted = onCompleted;
    this.queue = [];
    this.active = null;
    this.counter = 0;
  }

  get downloadsDir() {
    return store.ensureDownloadDir(this.getConfig());
  }

  enqueue(nasPath, name, size) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `dl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const job = { id, nasPath, name: sanitizeFileName(name), size: Number(size) || 0, resolve, reject };
      this.queue.push(job);
      this.send('download:queued', { id, nasPath, name: job.name, position: this.queue.length });
      this.pump();
    });
  }

  pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift();
    this.active = job;
    this.run(job).then((result) => {
      this.active = null;
      job.resolve(result);
      this.pump();
    }).catch((err) => {
      this.active = null;
      job.reject(err);
      this.pump();
    });
  }

  emitProgress(job, received, total, method, phase) {
    const now = Date.now();
    if (!job._lastEmit || now - job._lastEmit > 120 || phase !== 'downloading') {
      job._lastEmit = now;
      this.send('download:progress', {
        id: job.id,
        nasPath: job.nasPath,
        name: job.name,
        received,
        total,
        method,
        phase,
      });
    }
  }

  async run(job) {
    const config = this.getConfig();
    const dir = this.downloadsDir;
    const finalPath = uniqueDestination(dir, job.name);
    const ext = extOf(finalPath);
    const partPath = `${finalPath}${PART_SUFFIX}`;
    const startedAt = Date.now();

    this.send('download:start', {
      id: job.id,
      nasPath: job.nasPath,
      name: job.name,
      path: finalPath,
      size: job.size,
      category: categoryOf(finalPath),
    });
    log.info('开始下载:', job.nasPath, '->', finalPath);

    let method = 'file-station';
    let fsError = null;
    try {
      await this.nas.downloadToFile(job.nasPath, partPath, (received, total) => {
        this.emitProgress(job, received, total, method, 'downloading');
      });
      validateDownloadedFile(partPath, ext);
    } catch (err) {
      fsError = err;
      log.warn('FileStation 下载失败，尝试 SMB:', err.code || '', err.message);
      try { fs.rmSync(partPath, { force: true }); } catch (_) { /* ignore */ }
      this.send('download:fallback', {
        id: job.id,
        nasPath: job.nasPath,
        name: job.name,
        reason: err.message || 'FileStation 不可用',
      });
      method = 'smb';
      try {
        const nasConfig = config.nas;
        await copyViaSmb({
          host: nasConfig.host.replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
          user: NAS_USER,
          pass: NAS_PASS,
          nasPath: job.nasPath,
          destPart: partPath,
          onProgress: (received, total) => {
            this.emitProgress(job, received, total, method, 'downloading');
          },
        });
        validateDownloadedFile(partPath, ext);
      } catch (smbErr) {
        try { fs.rmSync(partPath, { force: true }); } catch (_) { /* ignore */ }
        const message = `下载失败：FileStation（${fsError.message}）；共享盘（${smbErr.message}）`;
        log.error('下载失败:', job.nasPath, message);
        this.send('download:error', {
          id: job.id,
          nasPath: job.nasPath,
          name: job.name,
          message,
          fileStationError: fsError.message,
          smbError: smbErr.message,
        });
        throw new Error(message);
      }
    }

    try {
      fs.renameSync(partPath, finalPath);
    } catch (err) {
      try { fs.rmSync(partPath, { force: true }); } catch (_) { /* ignore */ }
      this.send('download:error', { id: job.id, nasPath: job.nasPath, name: job.name, message: `保存文件失败：${err.message}` });
      throw err;
    }

    const stat = fs.statSync(finalPath);
    const result = {
      id: job.id,
      ok: true,
      nasPath: job.nasPath,
      path: finalPath,
      name: path.basename(finalPath),
      size: stat.size,
      ext,
      category: categoryOf(finalPath),
      method,
      elapsed: Date.now() - startedAt,
      source: 'nas',
    };
    store.addRecent(finalPath, 'nas');
    log.info('下载完成:', finalPath, `${stat.size} bytes`, method, `${result.elapsed}ms`);
    this.send('recent:updated', store.get().recent);
    this.send('download:complete', result);
    if (this.onCompleted) {
      Promise.resolve().then(() => this.onCompleted(result)).catch((err) => {
        log.warn('下载完成后的打开动作失败:', err.message);
      });
    }
    return result;
  }

  cancelAll() {
    this.queue = [];
  }
}

class DownloadsWatcher {
  constructor({ getDir, onNewFile }) {
    this.getDir = getDir;
    this.onNewFile = onNewFile;
    this.known = new Map();
    this.pending = new Map();
    this.watcher = null;
    this.interval = null;
    this.scanTimer = null;
    this.dir = '';
    this.started = false;
  }

  start() {
    this.dir = this.getDir();
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (_) { /* ignore */ }
    this.snapshot();
    this.attachWatcher();
    this.interval = setInterval(() => this.scan(false), 2000);
    this.started = true;
    log.info('下载目录监听已启动:', this.dir);
  }

  snapshot() {
    this.known.clear();
    this.pending.clear();
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isFile() || isIgnoredName(entry.name)) continue;
      const full = path.join(this.dir, entry.name);
      try {
        const stat = fs.statSync(full);
        this.known.set(full, { size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (_) { /* ignore */ }
    }
  }

  attachWatcher() {
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) { /* ignore */ }
      this.watcher = null;
    }
    try {
      this.watcher = fs.watch(this.dir, { persistent: true }, () => this.scheduleScan());
      this.watcher.on('error', (err) => log.warn('下载目录监听错误:', err.message));
    } catch (err) {
      log.warn('无法监听下载目录:', this.dir, err.message);
    }
  }

  scheduleScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.scan(false);
    }, 450);
  }

  scan(isInitial) {
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch (_) { return; }
    const seen = new Set();

    for (const entry of entries) {
      if (!entry.isFile() || isIgnoredName(entry.name)) continue;
      const full = path.join(this.dir, entry.name);
      seen.add(full);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (!stat.size) continue;

      const previous = this.known.get(full);
      if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
        this.pending.delete(full);
        continue;
      }
      if (previous && previous.size !== stat.size) {
        // 文件正在被写入，等待下一次稳定扫描。
      }

      const pending = this.pending.get(full);
      if (!pending || pending.size !== stat.size) {
        this.pending.set(full, { size: stat.size, at: Date.now(), mtimeMs: stat.mtimeMs });
        continue;
      }
      if (Date.now() - pending.at < 1100) continue;

      this.pending.delete(full);
      this.known.set(full, { size: stat.size, mtimeMs: stat.mtimeMs });
      if (!isInitial) {
        log.info('监听发现新文件:', full);
        try {
          this.onNewFile(full, { size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (err) {
          log.warn('处理新文件失败:', err.message);
        }
      }
    }

    for (const key of Array.from(this.known.keys())) {
      if (!seen.has(key)) this.known.delete(key);
    }
    for (const key of Array.from(this.pending.keys())) {
      if (!seen.has(key)) this.pending.delete(key);
    }
  }

  restart() {
    const next = this.getDir();
    if (next === this.dir) return;
    this.stop();
    this.start();
  }

  stop() {
    this.started = false;
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) { /* ignore */ }
      this.watcher = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }
}

function cleanupOldParts(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(PART_SUFFIX)) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(full, { force: true });
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

module.exports = {
  DownloadManager,
  DownloadsWatcher,
  validateDownloadedFile,
  sanitizeFileName,
  uniqueDestination,
  isIgnoredName,
  cleanupOldParts,
  copyViaSmb,
  PART_SUFFIX,
};
