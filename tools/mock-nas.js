'use strict';

/**
 * 本地模拟群晖 NAS，供开发调试使用。
 * 只实现启动器需要的 FileStation 登录、列目录、下载接口。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.MOCK_PORT) || 5899;
const DATA_DIR = path.join(__dirname, 'mock-data');
const SID = 'mock-sid-sunrise';
const TOKEN = 'mock-token';

const TREE = {
  '/': null,
  '/高三': ['语文'],
  '/高三/语文': [
    '2026',
    '2027届1与3班',
    'A早读课件',
    '奇点班林',
    '孙喆',
    '孙晓蓓',
    '安',
    '李秋萍',
    '蔡红英',
    '薛琦',
    '赖粤',
    '1105周四阅读课.pptx',
  ],
  '/高三/语文/2026': [
    '1.7.pptx',
    '1.25练习.docx',
    '听课记录.docx',
    '成绩单.xlsx',
    '语文近五年高考题.zip',
    '挨揍.mp4',
    '风景.jpg',
    '讲义.pdf',
    '单词表.csv',
  ],
};

const DIRS = new Set([
  '/高三', '/高三/语文', '/高三/语文/2026',
  '/高三/语文/2027届1与3班', '/高三/语文/A早读课件', '/高三/语文/奇点班林',
  '/高三/语文/孙喆', '/高三/语文/孙晓蓓', '/高三/语文/安', '/高三/语文/李秋萍',
  '/高三/语文/蔡红英', '/高三/语文/薛琦', '/高三/语文/赖粤',
]);

const SHARES = ['教师文件夹', '科技比赛', '高一', '高三', '高二'];

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fileStat(name) {
  const full = path.join(DATA_DIR, name);
  try {
    const stat = fs.statSync(full);
    return { size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) };
  } catch (_) {
    return { size: null, mtime: Math.floor(Date.now() / 1000) };
  }
}

function itemOf(folder, name) {
  const itemPath = folder === '/' ? `/${name}` : `${folder}/${name}`;
  const isdir = DIRS.has(itemPath) || !path.extname(name);
  const stat = isdir ? { size: null, mtime: Math.floor(Date.now() / 1000) } : fileStat(name);
  return {
    name,
    path: itemPath,
    isdir,
    additional: {
      size: stat.size,
      time: { mtime: stat.mtime },
      type: isdir ? 'dir' : 'file',
    },
  };
}

function list(folderPath) {
  if (folderPath === '/') {
    return SHARES.map((name) => ({
      name,
      path: `/${name}`,
      isdir: true,
      additional: { size: null, time: { mtime: Math.floor(Date.now() / 1000) }, type: 'dir' },
    }));
  }
  const names = TREE[folderPath];
  if (!names) {
    if (DIRS.has(folderPath)) return [];
    return null;
  }
  return names.map((name) => itemOf(folderPath, name));
}

function handleApi(req, res, url) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      for (const [key, value] of form) url.searchParams.set(key, value);
      routeApi(req, res, url);
    });
    return;
  }
  routeApi(req, res, url);
}

function routeApi(req, res, url) {
  const params = url.searchParams;
  const api = params.get('api');

  if (api === 'SYNO.API.Auth') {
    console.log(`[mock-nas] login account=${params.get('account')} session=${params.get('session')}`);
    json(res, {
      success: true,
      data: {
        sid: SID,
        synotoken: TOKEN,
        did: 'mock-device',
        is_portal_port: false,
      },
    });
    return;
  }

  if (params.get('SynoToken') !== TOKEN && params.get('api') !== 'SYNO.API.Info') {
    json(res, { success: false, error: { code: 119 } });
    return;
  }

  if (api === 'SYNO.FileStation.List') {
    const method = params.get('method');
    if (method === 'list_share') {
      json(res, {
        success: true,
        data: {
          total: SHARES.length,
          offset: 0,
          shares: SHARES.map((name) => ({ name, path: `/${name}`, isdir: true })),
        },
      });
      return;
    }
    if (method === 'list') {
      const folderPath = params.get('folder_path') || '/';
      console.log(`[mock-nas] list ${folderPath}`);
      const files = list(folderPath);
      if (!files) {
        json(res, { success: false, error: { code: 900 } });
        return;
      }
      json(res, { success: true, data: { total: files.length, offset: 0, files } });
      return;
    }
  }

  if (api === 'SYNO.FileStation.Download') {
    let paths;
    try {
      paths = JSON.parse(params.get('path') || '[]');
    } catch (_) {
      paths = [];
    }
    const target = Array.isArray(paths) && paths[0];
    if (!target) {
      json(res, { success: false, error: { code: 900 } });
      return;
    }
    const name = path.basename(target);
    const full = path.join(DATA_DIR, name);
    if (!fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>404</body></html>');
      return;
    }
    const stat = fs.statSync(full);
    console.log(`[mock-nas] download ${target} (${stat.size} bytes)`);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    const stream = fs.createReadStream(full, { highWaterMark: 64 * 1024 });
    stream.pipe(res);
    stream.on('error', () => {
      try { res.destroy(); } catch (_) { /* ignore */ }
    });
    return;
  }

  json(res, { success: false, error: { code: 103 } });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/webapi/entry.cgi' || url.pathname === '/webapi/query.cgi') {
    try {
      handleApi(req, res, url);
    } catch (err) {
      console.error('[mock-nas] error', err);
      json(res, { success: false, error: { code: 500, message: err.message } }, 500);
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<html><body><h1>Sunrise Mock NAS</h1><p>Use the launcher to browse.</p></body></html>');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-nas] ready on http://127.0.0.1:${PORT}`);
  console.log('[mock-nas] MOCK_NAS_READY');
});

server.on('error', (err) => {
  console.error('[mock-nas] listen error:', err.message);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
