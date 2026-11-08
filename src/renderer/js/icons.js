const svg = (body, viewBox = '0 0 24 24', extra = '') =>
  `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;

export const ICON = {
  sun: svg(`
    <circle cx="12" cy="12" r="4.1" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="1.55" stroke-linecap="round">
      <path d="M12 2.1v2.4M12 19.5v2.4M2.1 12h2.4M19.5 12h2.4"/>
      <path d="M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M19.2 4.8l-1.7 1.7M6.5 17.5l-1.7 1.7"/>
    </g>`),
  gear: svg(`
    <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.7"/>
    <path d="M19.4 13.5c.08-.5.08-1 0-1.5l1.5-1.1-1.7-2.9-1.8.7c-.4-.32-.84-.58-1.3-.78L15.8 6h-3.4l-.3 1.9c-.5.2-.95.46-1.35.78l-1.8-.7-1.7 2.9 1.5 1.1c-.08.5-.08 1 0 1.5l-1.5 1.1 1.7 2.9 1.8-.7c.4.32.85.58 1.35.78l.3 1.9h3.4l.3-1.9c.5-.2.95-.46 1.35-.78l1.8.7 1.7-2.9-1.5-1.1Z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/>`),
  moon: svg(`
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  sunSmall: svg(`
    <circle cx="12" cy="12" r="3.8" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  arrowLeft: svg(`
    <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowUp: svg(`
    <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  chevronRight: svg(`
    <path d="M9.5 5.5 16 12l-6.5 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  refresh: svg(`
    <path d="M20 11.2a8 8 0 1 0-2 6.3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    <path d="M20 4.8v6.4h-6.4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`),
  download: svg(`
    <path d="M12 4v10.5M7.8 10.5 12 14.7l4.2-4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 18.5h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  folder: svg(`
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4.1l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  folderOpen: svg(`
    <path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h4l2 2h6A2.5 2.5 0 0 1 20.5 10v1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M3.6 11.2h16.8l-1.6 6.2a2 2 0 0 1-1.94 1.5H6.1a2 2 0 0 1-1.94-1.5l-.56-6.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  file: svg(`
    <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M13.3 3.8V8h4.2M8.8 12h6M8.8 15.3h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
  presentation: svg(`
    <rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 16.5v3.2M8.6 21h6.8M7.5 12.5l3-3 2.3 2.2 3.5-3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  document: svg(`
    <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M13.3 3.8V8h4.2M8.8 11.5h6M8.8 14.6h6M8.8 17.7h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
  sheet: svg(`
    <rect x="3.8" y="4.2" width="16.4" height="15.6" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M3.8 9h16.4M9.4 9v10.8M3.8 14.4h16.4" stroke="currentColor" stroke-width="1.6"/>`),
  pdf: svg(`
    <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M13.3 3.8V8h4.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M8.6 17.4c2.6-1 5.5-3.9 6.4-6.4.3-.8-.7-1.4-1.2-.6-1.3 2.2-1.1 6 1.7 7.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>`),
  video: svg(`
    <rect x="3.5" y="5.5" width="12.5" height="13" rx="2.5" stroke="currentColor" stroke-width="1.7"/>
    <path d="M16 10.2l4-2.3v8.2l-4-2.3v-3.6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  image: svg(`
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.7"/>
    <circle cx="8.6" cy="9.5" r="1.6" stroke="currentColor" stroke-width="1.5"/>
    <path d="M4.5 17.5 9.7 12.8l3.1 2.8 3-2.7 4.2 4.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  audio: svg(`
    <path d="M9 17.5V7.8l9-2v9.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="6.9" cy="17.6" r="2.4" stroke="currentColor" stroke-width="1.7"/>
    <circle cx="15.9" cy="15.6" r="2.4" stroke="currentColor" stroke-width="1.7"/>`),
  archive: svg(`
    <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M13.3 3.8V8h4.2M10.6 4.2v1.6M10.6 7.4v1.6M10.6 10.6v1.6M9.4 14.2h2.4v2.6H9.4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  courseware: svg(`
    <rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 16.5v3.2M8.6 21h6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M7.6 12.4 10 8.6l2 2.6 2-3.2 2.4 4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  search: svg(`
    <circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" stroke-width="1.8"/>
    <path d="m15.5 15.5 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  close: svg(`
    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
  check: svg(`
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  warning: svg(`
    <path d="M12 3.6 21 19.5H3L12 3.6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 9v4.4M12 16.5v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
  info: svg(`
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 11v5M12 8v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
  copy: svg(`
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8a1.5 1.5 0 0 0 1.5 1.5h2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
  external: svg(`
    <path d="M14 4.5h5.5V10M19 5l-7.5 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  trash: svg(`
    <path d="M4.5 7h15M9 7V5.2c0-.4.3-.7.7-.7h4.6c.4 0 .7.3.7.7V7M7 7l.7 12.3c0 .4.4.7.8.7h7c.4 0 .8-.3.8-.7L17 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 10.5v6M14 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  play: svg(`
    <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.2-6.2c.6-.4.6-1.4 0-1.8L9.6 4.9c-.7-.4-1.6.1-1.6.9Z" fill="currentColor"/>`),
  cloud: svg(`
    <path d="M7 18.5a4.2 4.2 0 0 1-.5-8.4A6 6 0 0 1 18 9.6a4.6 4.6 0 0 1 .4 8.9H7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  home: svg(`
    <path d="M4.5 10.3 12 4l7.5 6.3V19a1 1 0 0 1-1 1h-4.2v-5.2H9.7V20H5.5a1 1 0 0 1-1-1v-8.7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  monitor: svg(`
    <rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 16.5v3M8.5 20h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
  wifi: svg(`
    <path d="M3.5 9.5a13 13 0 0 1 17 0M6.5 12.8a8.4 8.4 0 0 1 11 0M9.6 16.1a3.8 3.8 0 0 1 4.8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="19" r="1" fill="currentColor"/>`),
  logs: svg(`
    <path d="M5 4.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7"/>
    <path d="M7.5 8h9M7.5 11.5h9M7.5 15h5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  quit: svg(`
    <path d="M14.5 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M10 8.5 6.5 12 10 15.5M6.5 12H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  spark: svg(`
    <path d="M12 3.5c.5 4.6 2.3 6.4 6.9 6.9-4.6.5-6.4 2.3-6.9 6.9-.5-4.6-2.3-6.4-6.9-6.9 4.6-.5 6.4-2.3 6.9-6.9Z" fill="currentColor"/>`),
  lock: svg(`
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" stroke-width="1.7"/>
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
};

const tileSvg = (body) => svg(body, '0 0 48 48');

export const APP_ICON = {
  wps: tileSvg(`
    <rect x="8" y="5.5" width="32" height="37" rx="8" fill="none" stroke="currentColor" stroke-width="2" opacity=".48"/>
    <path d="M13.8 17.2 18.2 31h2.7l3.1-9.7 3.1 9.7h2.7l4.4-13.8h-3.4l-2.8 9.8-3.1-9.8h-1.9l-3.1 9.8-2.8-9.8h-3.3Z" fill="currentColor"/>
    <path d="M15.5 10.2h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".42"/>`),
  board: tileSvg(`
    <rect x="6" y="8.5" width="36" height="25" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <path d="M12 26.5 19 18l5 4.8 5.2-7.6 7 11.3" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="34.5" cy="15.5" r="2.7" fill="currentColor"/>
    <path d="M24 33.5v5M18 41h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>`),
  camera: tileSvg(`
    <rect x="9" y="6.5" width="30" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <circle cx="24" cy="16" r="5.4" stroke="currentColor" stroke-width="2.2"/>
    <circle cx="24" cy="16" r="1.8" fill="currentColor"/>
    <path d="M24 25.5v8.5M16 41h16M20 34.5h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>
    <path d="M34.5 11.5h.1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`),
  ftp: tileSvg(`
    <path d="M6 16.2A4.2 4.2 0 0 1 10.2 12h8.4l3.8 3.8h15.4A4.2 4.2 0 0 1 42 20v14.6A4.2 4.2 0 0 1 37.8 38.8H10.2A4.2 4.2 0 0 1 6 34.6V16.2Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M24 20.5v11M19.5 27l4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M17 20.5h4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".42"/>`),
};

const FILE_RGB = {
  folder: '216, 156, 104',
  presentation: '214, 124, 94',
  document: '140, 163, 196',
  sheet: '140, 166, 124',
  pdf: '199, 106, 96',
  video: '176, 148, 196',
  image: '126, 168, 154',
  audio: '206, 168, 104',
  archive: '196, 146, 104',
  courseware: '120, 166, 156',
  other: '158, 148, 136',
};

const FILE_ICON = {
  folder: ICON.folder,
  presentation: ICON.presentation,
  document: ICON.document,
  sheet: ICON.sheet,
  pdf: ICON.pdf,
  video: ICON.video,
  image: ICON.image,
  audio: ICON.audio,
  archive: ICON.archive,
  courseware: ICON.courseware,
  other: ICON.file,
};

const FILE_LABEL = {
  folder: '文件夹',
  presentation: '演示文稿',
  document: 'Word 文档',
  sheet: '表格',
  pdf: 'PDF 文档',
  video: '视频',
  image: '图片',
  audio: '音频',
  archive: '压缩包',
  courseware: '希沃课件',
  other: '文件',
};

const EXT_TO_CATEGORY = {
  ppt: 'presentation', pptx: 'presentation', pptm: 'presentation', pps: 'presentation', ppsx: 'presentation', dps: 'presentation', dpt: 'presentation',
  doc: 'document', docx: 'document', docm: 'document', dot: 'document', dotx: 'document', wps: 'document', rtf: 'document', wpt: 'document',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', xlt: 'sheet', xltx: 'sheet', et: 'sheet', ett: 'sheet', csv: 'sheet',
  pdf: 'pdf',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video', webm: 'video', m4v: 'video', ts: 'video', mpg: 'video', mpeg: 'video', rmvb: 'video', '3gp': 'video', ogv: 'video',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image', tif: 'image', tiff: 'image', heic: 'image', avif: 'image',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio', wma: 'audio', ape: 'audio', opus: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', iso: 'archive',
  enbx: 'courseware', enbx2: 'courseware', enp: 'courseware',
};

export function fileCategory(ext, isdir = false) {
  if (isdir) return 'folder';
  return EXT_TO_CATEGORY[String(ext || '').toLowerCase()] || 'other';
}

export function fileVisual(ext, isdir = false) {
  const category = fileCategory(ext, isdir);
  return {
    category,
    svg: FILE_ICON[category],
    rgb: FILE_RGB[category],
    label: category === 'document'
      ? (String(ext || '').toLowerCase() === 'docx' ? 'Word 文档' : '文档')
      : category === 'sheet'
        ? '表格'
        : FILE_LABEL[category],
  };
}

export function extOfName(name) {
  const index = String(name || '').lastIndexOf('.');
  return index > 0 ? String(name).slice(index + 1).toLowerCase() : '';
}
