'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { shell, app } = require('electron');
const {
  APP_DEFS,
  VIDEO_EXTS,
  PRESENTATION_EXTS,
  DOCUMENT_EXTS,
  SHEET_EXTS,
  PDF_EXTS,
  IMAGE_EXTS,
  AUDIO_EXTS,
  ARCHIVE_EXTS,
  COURSEWARE_EXTS,
  GITHUB_URL,
  categoryOf,
  extOf,
} = require('./constants');
const log = require('./logger');

const DANGEROUS_EXTS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'reg', 'jar', 'lnk', 'url', 'hta', 'cpl', 'pif']);

const VLC_CANDIDATES = [
  'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
  'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
  path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
];
const POTPLAYER_CANDIDATES = [
  'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini.exe',
  'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini.exe',
];
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let cache = { at: 0, data: null };

function wildcardToRegExp(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function globSync(pattern) {
  if (!pattern || pattern.includes('undefined')) return [];
  const parts = pattern.split('\\').filter(Boolean);
  if (parts.length < 2) return [];
  let current = [parts[0] + '\\'];
  for (let i = 1; i < parts.length; i += 1) {
    const segment = parts[i];
    const next = [];
    for (const base of current) {
      if (segment.includes('*') || segment.includes('?')) {
        let entries = [];
        try {
          entries = fs.readdirSync(base, { withFileTypes: true });
        } catch (_) { continue; }
        const re = wildcardToRegExp(segment);
        for (const entry of entries) {
          if (re.test(entry.name)) next.push(path.join(base, entry.name));
        }
      } else {
        next.push(path.join(base, segment));
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current.filter((p) => {
    try { return fs.statSync(p).isFile(); } catch (_) { return false; }
  });
}

function firstExisting(list) {
  for (const p of list) {
    if (!p) continue;
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (_) { /* continue */ }
  }
  return '';
}

function findWpsExe(config) {
  if (config && config.wpsPath) {
    if (/wps\.exe$/i.test(config.wpsPath) && fs.existsSync(config.wpsPath)) return config.wpsPath;
    const sibling = path.join(path.dirname(config.wpsPath), 'office6', 'wps.exe');
    if (fs.existsSync(sibling)) return sibling;
  }
  const direct = [
    'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\12.1.0.19302\\office6\\wps.exe',
    'C:\\Program Files\\Kingsoft\\WPS Office\\12.1.0.19302\\office6\\wps.exe',
  ];
  const foundDirect = firstExisting(direct);
  if (foundDirect) return foundDirect;
  for (const pattern of [
    'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\*\\office6\\wps.exe',
    'C:\\Program Files\\Kingsoft\\WPS Office\\*\\office6\\wps.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Kingsoft', 'WPS Office', '*', 'office6', 'wps.exe'),
  ]) {
    const found = globSync(pattern);
    if (found.length) {
      found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      return found[0];
    }
  }
  return '';
}

function detect(config) {
  const now = Date.now();
  if (cache.data && now - cache.at < 15000) return cache.data;

  const wpsExe = findWpsExe(config);
  const wpsLauncher = firstExisting([
    'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\ksolaunch.exe',
    'C:\\Program Files\\Kingsoft\\WPS Office\\ksolaunch.exe',
  ]);

  const board = firstExisting(APP_DEFS.board.candidates)
    || globSync(APP_DEFS.board.globs[0])[0]
    || globSync(APP_DEFS.board.globs[1])[0]
    || '';
  const camera = firstExisting(APP_DEFS.camera.candidates)
    || globSync(APP_DEFS.camera.globs[0])[0]
    || globSync(APP_DEFS.camera.globs[1])[0]
    || '';

  const vlc = firstExisting(VLC_CANDIDATES);
  const potplayer = firstExisting(POTPLAYER_CANDIDATES);
  const edge = firstExisting(EDGE_CANDIDATES);

  const data = {
    wps: {
      available: Boolean(wpsExe || wpsLauncher),
      path: wpsLauncher || wpsExe,
      officeExe: wpsExe,
      officeDir: wpsExe ? path.dirname(wpsExe) : '',
    },
    board: { available: Boolean(board), path: board },
    camera: { available: Boolean(camera), path: camera },
    ftp: { available: true, path: '' },
    vlc: { available: Boolean(vlc), path: vlc },
    potplayer: { available: Boolean(potplayer), path: potplayer },
    edge: { available: Boolean(edge), path: edge },
  };
  if (process.env.SUNRISE_FAKE_APPS === '1') {
    // 仅用于开发机截图与 UI 调试，不影响真实启动逻辑。
    data.wps.available = true;
    data.board.available = true;
    data.camera.available = true;
    data.vlc.available = true;
  }
  cache = { at: now, data };
  return data;
}

function invalidate() {
  cache = { at: 0, data: null };
}

function spawnDetached(exe, args, options = {}) {
  const child = spawn(exe, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: options.cwd || path.dirname(exe),
  });
  child.on('error', (err) => log.error('启动进程失败:', exe, err.message));
  child.unref();
  return child;
}

async function launchApp(key, config) {
  const info = detect(config);
  if (key === 'wps') {
    if (!info.wps.available) {
      return { ok: false, message: '未找到 WPS Office，请检查安装或设置路径。' };
    }
    const exe = info.wps.path;
    spawnDetached(exe, [], { cwd: path.dirname(exe) });
    return { ok: true, message: '正在启动 WPS Office…', app: exe };
  }
  if (key === 'board') {
    if (!info.board.available) {
      return { ok: false, message: '未找到希沃白板 5，请确认希沃白板已安装。' };
    }
    spawnDetached(info.board.path, []);
    return { ok: true, message: '正在启动希沃白板…', app: info.board.path };
  }
  if (key === 'camera') {
    if (!info.camera.available) {
      return { ok: false, message: '未找到希沃视频展台，请确认展台软件已安装。' };
    }
    spawnDetached(info.camera.path, []);
    return { ok: true, message: '正在启动视频展台…', app: info.camera.path };
  }
  return { ok: false, message: '未知的启动项。' };
}

function pickVideoPlayer(config, info) {
  const preference = config.videoPlayer || 'auto';
  if (preference === 'vlc' && info.vlc.available) return { type: 'vlc', exe: info.vlc.path };
  if (preference === 'potplayer' && info.potplayer.available) return { type: 'potplayer', exe: info.potplayer.path };
  if (preference === 'system') return { type: 'system', exe: '' };
  if (info.vlc.available) return { type: 'vlc', exe: info.vlc.path };
  if (info.potplayer.available) return { type: 'potplayer', exe: info.potplayer.path };
  return { type: 'system', exe: '' };
}

async function openWithShell(filePath) {
  const result = await shell.openPath(filePath);
  if (result) return { ok: false, message: `无法打开文件：${result}` };
  return { ok: true, mode: 'external', app: 'system', message: '已用系统默认应用打开' };
}

async function openFile(filePath, config) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return { ok: false, message: '文件不存在或已被移动。' };
  }
  if (!stat.isFile()) return { ok: false, message: '目标不是一个文件。' };

  const ext = extOf(filePath);
  const info = detect(config);

  if (DANGEROUS_EXTS.has(ext)) {
    shell.showItemInFolder(filePath);
    return {
      ok: false,
      safe: false,
      mode: 'reveal',
      message: '为保护设备安全，启动器不会自动运行可执行文件，已为你定位到该文件。',
    };
  }

  if (COURSEWARE_EXTS.includes(ext)) {
    if (info.board.available) {
      spawnDetached(info.board.path, [filePath, '-m', 'Display']);
      return { ok: true, mode: 'external', app: 'board', message: '正在用希沃白板打开课件…' };
    }
    return { ok: false, message: '未找到希沃白板，无法打开 .enbx 课件。' };
  }

  if (VIDEO_EXTS.includes(ext)) {
    const player = pickVideoPlayer(config, info);
    if (player.type === 'vlc') {
      spawnDetached(player.exe, ['--fullscreen', '--play-and-exit', '--no-video-title-show', '--quiet', filePath]);
      return { ok: true, mode: 'external', app: 'vlc', message: '正在用 VLC 全屏播放…' };
    }
    if (player.type === 'potplayer') {
      spawnDetached(player.exe, [filePath, '/fullscreen']);
      return { ok: true, mode: 'external', app: 'potplayer', message: '正在用 PotPlayer 播放…' };
    }
    return openWithShell(filePath);
  }

  if (AUDIO_EXTS.includes(ext)) {
    if (info.vlc.available) {
      spawnDetached(info.vlc.path, ['--play-and-exit', '--no-video-title-show', '--quiet', filePath]);
      return { ok: true, mode: 'external', app: 'vlc', message: '正在用 VLC 播放音频…' };
    }
    return openWithShell(filePath);
  }

  if (IMAGE_EXTS.includes(ext)) {
    return { ok: true, mode: 'internal-image', app: 'sunrise', message: '', path: filePath };
  }

  if (PRESENTATION_EXTS.includes(ext) || DOCUMENT_EXTS.includes(ext) || SHEET_EXTS.includes(ext) || PDF_EXTS.includes(ext)) {
    if (info.wps.officeExe) {
      let flag = '/wps';
      if (PRESENTATION_EXTS.includes(ext)) flag = '/wpp';
      else if (SHEET_EXTS.includes(ext)) flag = '/et';
      else if (PDF_EXTS.includes(ext)) flag = '/pdf';
      spawnDetached(info.wps.officeExe, ['/prometheus', flag, filePath], { cwd: info.wps.officeDir });
      return { ok: true, mode: 'external', app: 'wps', message: '正在用 WPS 打开…' };
    }
    if (PDF_EXTS.includes(ext) && info.edge.available) {
      spawnDetached(info.edge.path, [filePath]);
      return { ok: true, mode: 'external', app: 'edge', message: '正在用 Edge 打开 PDF…' };
    }
    return openWithShell(filePath);
  }

  if (ARCHIVE_EXTS.includes(ext)) {
    shell.showItemInFolder(filePath);
    return { ok: true, mode: 'reveal', app: 'explorer', message: '压缩包已定位，解压后即可使用。' };
  }

  return openWithShell(filePath);
}

function reveal(filePath) {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function openExternal(url) {
  const allowed = new Set([GITHUB_URL, 'https://github.com/JHCWColin']);
  let parsed;
  try { parsed = new URL(url); } catch (_) { return { ok: false }; }
  if (parsed.protocol !== 'https:') return { ok: false, message: '仅允许打开 HTTPS 链接' };
  if (!allowed.has(parsed.href) && !allowed.has(`${parsed.origin}${parsed.pathname}`)) {
    return { ok: false, message: '该链接不在允许列表中' };
  }
  await shell.openExternal(parsed.href);
  return { ok: true };
}

module.exports = {
  detect,
  invalidate,
  launchApp,
  openFile,
  openWithShell,
  reveal,
  openExternal,
  DANGEROUS_EXTS,
  _globSync: globSync,
};
