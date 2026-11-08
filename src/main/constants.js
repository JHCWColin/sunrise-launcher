'use strict';

const path = require('path');

const APP_NAME = '旭日东升';
const APP_NAME_EN = 'SUNRISE LAUNCHER';
const APP_TAGLINE = '让每一堂课，一键启程';
const APP_ID = 'com.jhcwcolin.sunrise';
const DEVELOPER_CREDIT = '由JHCWColin与DeepSeek共同创作。';
const GITHUB_URL = 'https://github.com/JHCWColin/sunrise-launcher';

// 班级部署内置的 NAS 教师账号。使用轻量异或编码，避免在源码与日志中直接出现明文。
// 该账号仅能访问校内 NAS，请勿将安装包公开传播到校外。
const _k = 'Sunrise2026';
function _reveal(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  for (let i = 0; i < buf.length; i += 1) buf[i] ^= _k.charCodeAt(i % _k.length);
  return buf.toString('utf8');
}

const NAS_USER = process.env.SUNRISE_NAS_USER || _reveal('u9fvl9bTgr2y');
const NAS_PASS = process.env.SUNRISE_NAS_PASS !== undefined
  ? process.env.SUNRISE_NAS_PASS
  : _reveal('cw==');

const NAS_DEFAULTS = Object.freeze({
  host: '10.82.58.2',
  port: 5001,
  https: true,
  allowSelfSigned: true,
  defaultPath: '/高三/语文',
  timeoutMs: 20000,
});

const SHARE_NAMES = ['高三', '高二', '高一', '教师文件夹', '科技比赛'];

const APP_DEFS = {
  wps: {
    key: 'wps',
    name: 'WPS Office',
    subtitle: '文档 · 表格 · 演示',
    kind: 'app',
    accent: '#4b8cff',
    candidates: [
      'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\ksolaunch.exe',
      'C:\\Program Files\\Kingsoft\\WPS Office\\ksolaunch.exe',
      'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\office6\\wps.exe',
      'C:\\Program Files\\Kingsoft\\WPS Office\\office6\\wps.exe',
    ],
    globs: [
      'C:\\Program Files (x86)\\Kingsoft\\WPS Office\\*\\office6\\wps.exe',
      'C:\\Program Files\\Kingsoft\\WPS Office\\*\\office6\\wps.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Kingsoft', 'WPS Office', '*', 'office6', 'wps.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Kingsoft', 'WPS Office', 'office6', 'wps.exe'),
    ],
  },
  board: {
    key: 'board',
    name: '希沃白板',
    subtitle: '互动课件 · 课堂授课',
    kind: 'app',
    accent: '#20c7b7',
    candidates: [
      'C:\\Program Files (x86)\\Seewo\\EasiNote5\\swenlauncher\\swenlauncher.exe',
      'C:\\Program Files\\Seewo\\EasiNote5\\swenlauncher\\swenlauncher.exe',
    ],
    globs: [
      'C:\\Program Files (x86)\\Seewo\\EasiNote5\\*\\swenlauncher\\swenlauncher.exe',
      'C:\\Program Files\\Seewo\\EasiNote5\\*\\swenlauncher\\swenlauncher.exe',
    ],
    fallbackNames: ['EasiNote.exe'],
  },
  camera: {
    key: 'camera',
    name: '视频展台',
    subtitle: '实物拍摄 · 同步展示',
    kind: 'app',
    accent: '#8b7bff',
    candidates: [
      'C:\\Program Files (x86)\\Seewo\\EasiCamera\\sweclauncher\\sweclauncher.exe',
      'C:\\Program Files\\Seewo\\EasiCamera\\sweclauncher\\sweclauncher.exe',
    ],
    globs: [
      'C:\\Program Files (x86)\\Seewo\\EasiCamera\\*\\sweclauncher\\sweclauncher.exe',
      'C:\\Program Files\\Seewo\\EasiCamera\\*\\sweclauncher\\sweclauncher.exe',
    ],
    fallbackNames: ['EasiCamera.exe'],
  },
  ftp: {
    key: 'ftp',
    name: 'FTP 课件',
    subtitle: '高三 · 语文课件库',
    kind: 'internal',
    accent: '#ffb547',
  },
};

const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mpg', 'mpeg', 'rmvb', '3gp', 'ogv'];
const PRESENTATION_EXTS = ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'dps', 'dpt'];
const DOCUMENT_EXTS = ['doc', 'docx', 'docm', 'dot', 'dotx', 'wps', 'rtf', 'wpt'];
const SHEET_EXTS = ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'et', 'ett', 'csv'];
const PDF_EXTS = ['pdf'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff', 'heic', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'ape', 'opus'];
const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'];
const COURSEWARE_EXTS = ['enbx', 'enbx2', 'enp'];

const CATEGORY = {
  video: { exts: VIDEO_EXTS, label: '视频' },
  presentation: { exts: PRESENTATION_EXTS, label: '演示文稿' },
  document: { exts: DOCUMENT_EXTS, label: '文档' },
  sheet: { exts: SHEET_EXTS, label: '表格' },
  pdf: { exts: PDF_EXTS, label: 'PDF' },
  image: { exts: IMAGE_EXTS, label: '图片' },
  audio: { exts: AUDIO_EXTS, label: '音频' },
  archive: { exts: ARCHIVE_EXTS, label: '压缩包' },
  courseware: { exts: COURSEWARE_EXTS, label: '希沃课件' },
};

const ALL_KNOWN_EXTS = new Set(
  Object.values(CATEGORY).flatMap((c) => c.exts),
);

function categoryOf(filePath) {
  const ext = String(path.extname(filePath || '')).replace('.', '').toLowerCase();
  for (const [key, value] of Object.entries(CATEGORY)) {
    if (value.exts.includes(ext)) return key;
  }
  return 'other';
}

function extOf(filePath) {
  return String(path.extname(filePath || '')).replace('.', '').toLowerCase();
}

module.exports = {
  APP_NAME,
  APP_NAME_EN,
  APP_TAGLINE,
  APP_ID,
  DEVELOPER_CREDIT,
  GITHUB_URL,
  NAS_USER,
  NAS_PASS,
  NAS_DEFAULTS,
  SHARE_NAMES,
  APP_DEFS,
  CATEGORY,
  ALL_KNOWN_EXTS,
  VIDEO_EXTS,
  PRESENTATION_EXTS,
  DOCUMENT_EXTS,
  SHEET_EXTS,
  PDF_EXTS,
  IMAGE_EXTS,
  AUDIO_EXTS,
  ARCHIVE_EXTS,
  COURSEWARE_EXTS,
  categoryOf,
  extOf,
};
