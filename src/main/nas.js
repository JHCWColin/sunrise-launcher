'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL, URLSearchParams } = require('url');
const { NAS_USER, NAS_PASS, SHARE_NAMES } = require('./constants');
const log = require('./logger');

const FRIENDLY_ERRORS = {
  400: 'NAS 账号或密码不正确。',
  401: 'NAS 账号已被停用。',
  402: '该账号没有 File Station 权限。',
  403: '该账号需要两步验证，请联系管理员。',
  404: 'NAS 接口不存在，请检查 DSM 版本。',
  105: '当前账号没有访问该目录的权限。',
  106: '登录会话已过期，正在重新连接…',
  107: '账号在另一处登录，会话已失效。',
  108: '登录会话已失效，请重试。',
  119: '会话无效或没有权限，请重试。',
  900: 'NAS 文件不存在或路径无效。',
};

class NasError extends Error {
  constructor(message, code, detail) {
    super(message);
    this.name = 'NasError';
    this.code = code || 'NAS_ERROR';
    this.detail = detail || '';
  }
}

function normalizeTime(value) {
  if (!value) return 0;
  if (typeof value === 'object') {
    value = value.mtime ?? value.time ?? value.timestamp ?? 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeSize(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function friendlyCode(code) {
  return FRIENDLY_ERRORS[code] || `NAS 返回错误 ${code}。`;
}

function normalizeEntry(entry, parentPath) {
  const name = String(entry.name || '');
  const isdir = Boolean(entry.isdir);
  const additional = entry.additional && typeof entry.additional === 'object' ? entry.additional : {};
  const size = normalizeSize(additional.size ?? entry.size);
  const mtime = normalizeTime(additional.time ?? entry.time);
  let entryPath = entry.path || '';
  if (!entryPath) {
    entryPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
  }
  return { name, path: entryPath, isdir, size, mtime };
}

function sortEntries(items) {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  return items.sort((a, b) => {
    if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

class NasClient {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.session = null;
    this.loginPromise = null;
    this.agent = null;
    this.agentKey = '';
  }

  config() {
    return this.getConfig().nas;
  }

  host() {
    let host = String(this.config().host || '').trim();
    host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return host;
  }

  baseUrl() {
    const c = this.config();
    return `${c.https ? 'https' : 'http'}://${this.host()}:${c.port}`;
  }

  getAgent() {
    const c = this.config();
    const key = `${c.https}|${c.allowSelfSigned}`;
    if (this.agent && this.agentKey === key) return this.agent;
    if (this.agent) {
      try { this.agent.destroy(); } catch (_) { /* ignore */ }
    }
    this.agentKey = key;
    if (c.https) {
      this.agent = new https.Agent({
        rejectUnauthorized: !c.allowSelfSigned,
        keepAlive: true,
        maxSockets: 6,
      });
    } else {
      this.agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
    }
    return this.agent;
  }

  invalidate() {
    this.session = null;
    this.loginPromise = null;
    try { if (this.agent) this.agent.destroy(); } catch (_) { /* ignore */ }
    this.agent = null;
    this.agentKey = '';
  }

  buildQuery(params) {
    const pairs = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (this.session && this.session.token) {
      pairs.push(`SynoToken=${encodeURIComponent(this.session.token)}`);
    }
    return pairs.join('&');
  }

  buildUrl(params) {
    return `${this.baseUrl()}/webapi/entry.cgi?${this.buildQuery(params)}`;
  }

  requestOptions(method, params, extraHeaders = {}) {
    const url = new URL(this.buildUrl(params));
    const c = this.config();
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'SunriseLauncher/1.0 (SeeWo Classroom)',
      ...extraHeaders,
    };
    if (this.session) {
      headers.Cookie = `id=${this.session.sid}`;
      headers['X-SYNO-TOKEN'] = this.session.token;
    }
    return {
      method,
      hostname: url.hostname,
      port: url.port || (c.https ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      agent: this.getAgent(),
    };
  }

  requestJson(params, method = 'GET', body = null) {
    const c = this.config();
    const options = this.requestOptions(method, params, body ? {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    } : {});
    const transport = c.https ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 8 * 1024 * 1024) {
            req.destroy();
            reject(new NasError('NAS 返回内容过大。', 'TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = JSON.parse(text);
          } catch (_) {
            reject(new NasError(
              res.statusCode === 502
                ? 'NAS 下载服务暂时不可用（502），将尝试共享盘通道。'
                : `NAS 返回了无法解析的响应（HTTP ${res.statusCode}）。`,
              res.statusCode === 502 ? 'DOWNLOAD_502' : 'BAD_RESPONSE',
              text.slice(0, 200),
            ));
            return;
          }
          if (data && data.success === false) {
            const code = data.error && data.error.code ? Number(data.error.code) : 0;
            reject(new NasError(friendlyCode(code), code, JSON.stringify(data.error || {})));
            return;
          }
          resolve(data);
        });
      });
      req.setTimeout(c.timeoutMs, () => {
        req.destroy(new NasError('连接 NAS 超时，请检查网络。', 'TIMEOUT'));
      });
      req.on('error', (err) => {
        if (err instanceof NasError) {
          reject(err);
        } else {
          reject(new NasError(`无法连接课件服务器（${err.code || err.message}）。`, 'NETWORK', err.message));
        }
      });
      if (body) req.write(body);
      req.end();
    });
  }

  async login(force = false) {
    if (!force && this.session && this.session.expiresAt > Date.now()) return this.session;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const c = this.config();
      // 使用 encodeURIComponent 而不是 URLSearchParams，确保空格编码为 %20，
      // 与 DSM 官方示例及 PowerShell EscapeDataString 的行为一致。
      const body = [
        ['api', 'SYNO.API.Auth'],
        ['version', '7'],
        ['method', 'login'],
        ['account', NAS_USER],
        ['passwd', NAS_PASS],
        ['session', 'FileStation'],
        ['format', 'cookie'],
        ['enable_syno_token', 'yes'],
      ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

      log.info('NAS 登录:', this.baseUrl(), '账号:', NAS_USER);
      const data = await this.requestJson({}, 'POST', body);
      const payload = data && data.data ? data.data : {};
      if (!payload.sid) throw new NasError('NAS 登录响应缺少会话信息。', 'NO_SID');
      this.session = {
        sid: String(payload.sid),
        token: String(payload.synotoken || ''),
        did: payload.did ? String(payload.did) : '',
        expiresAt: Date.now() + 20 * 60 * 60 * 1000,
      };
      log.info('NAS 登录成功，会话有效期 20 小时');
      return this.session;
    })().finally(() => {
      this.loginPromise = null;
    });

    return this.loginPromise;
  }

  async call(params, retried = false) {
    await this.login();
    try {
      return await this.requestJson(params);
    } catch (err) {
      if (!retried && err instanceof NasError && [106, 107, 108, 119].includes(Number(err.code))) {
        log.warn('NAS 会话失效，重新登录:', err.code);
        this.invalidate();
        await this.login(true);
        return this.call(params, true);
      }
      throw err;
    }
  }

  async listShares() {
    const data = await this.call({
      api: 'SYNO.FileStation.List',
      version: '2',
      method: 'list_share',
    });
    const shares = data && data.data && Array.isArray(data.data.shares) ? data.data.shares : [];
    const preferred = new Map(SHARE_NAMES.map((name, index) => [name, index]));
    return shares.map((s) => ({
      name: String(s.name || ''),
      path: String(s.path || `/${s.name || ''}`),
      isdir: true,
      size: null,
      mtime: 0,
    })).filter((s) => s.name).sort((a, b) => {
      const ai = preferred.has(a.name) ? preferred.get(a.name) : 99;
      const bi = preferred.has(b.name) ? preferred.get(b.name) : 99;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  async list(folderPath) {
    const target = folderPath && folderPath !== '/' ? folderPath : '/';
    if (target === '/') {
      const shares = await this.listShares();
      return { path: '/', isRoot: true, items: shares, total: shares.length };
    }
    const data = await this.call({
      api: 'SYNO.FileStation.List',
      version: '2',
      method: 'list',
      folder_path: target,
      additional: '["size","time","type"]',
      sort_by: 'name',
      sort_direction: 'asc',
    });
    const raw = data && data.data && Array.isArray(data.data.files) ? data.data.files : [];
    const items = sortEntries(raw.map((entry) => normalizeEntry(entry, target)));
    return { path: target, isRoot: false, items, total: items.length };
  }

  async testConnection() {
    this.invalidate();
    const started = Date.now();
    await this.login(true);
    const shares = await this.listShares();
    return {
      ok: true,
      latency: Date.now() - started,
      shares: shares.map((s) => s.name),
      baseUrl: this.baseUrl(),
    };
  }

  /**
   * 通过 FileStation 下载到 .part 文件。
   * 返回 { bytes, contentType }；失败会抛出 NasError。
   */
  async downloadToFile(nasPath, destPart, onProgress) {
    await this.login();

    const c = this.config();
    const transport = c.https ? https : http;
    const pathJson = JSON.stringify([nasPath]);
    const startUrl = this.buildUrl({
      api: 'SYNO.FileStation.Download',
      version: '2',
      method: 'download',
      path: pathJson,
      mode: '"open"',
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { fs.rmSync(destPart, { force: true }); } catch (_) { /* ignore */ }
        reject(err instanceof NasError ? err : new NasError(err.message || '下载失败', 'DOWNLOAD'));
      };
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const attempt = (urlText, redirectsLeft) => {
        if (settled) return;
        const url = new URL(urlText);
        const headers = {
          Accept: '*/*',
          'User-Agent': 'SunriseLauncher/1.0 (SeeWo Classroom)',
          Cookie: `id=${this.session ? this.session.sid : ''}`,
          'X-SYNO-TOKEN': this.session ? this.session.token : '',
        };
        const options = {
          method: 'GET',
          hostname: url.hostname,
          port: url.port || (c.https ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          headers,
          agent: this.getAgent(),
        };

        const req = transport.request(options, (res) => {
          const status = res.statusCode || 0;
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          const total = Number(res.headers['content-length']) || 0;

          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              fail(new NasError('下载重定向次数过多，已切换共享盘通道。', 'REDIRECT'));
              return;
            }
            try {
              const next = new URL(res.headers.location, url);
              attempt(next.toString(), redirectsLeft - 1);
            } catch (_) {
              fail(new NasError('下载重定向地址无效。', 'REDIRECT'));
            }
            return;
          }
          if (status !== 200) {
            res.resume();
            fail(new NasError(
              status === 502 ? 'NAS 下载接口返回 502，正在切换共享盘通道…' : `NAS 下载失败（HTTP ${status}）。`,
              status === 502 ? 'DOWNLOAD_502' : `HTTP_${status}`,
            ));
            return;
          }
          if (contentType.includes('text/html')) {
            res.resume();
            fail(new NasError('NAS 返回了网页而不是文件，正在切换共享盘通道…', 'DOWNLOAD_HTML'));
            return;
          }
          if (contentType.includes('application/json')) {
            const chunks = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let code = 0;
              try { code = JSON.parse(text).error.code; } catch (_) { /* ignore */ }
              fail(new NasError(friendlyCode(code), code || 'DOWNLOAD_JSON', text.slice(0, 200)));
            });
            return;
          }

          fs.mkdirSync(path.dirname(destPart), { recursive: true });
          const out = fs.createWriteStream(destPart);
          let received = 0;
          let finished = false;

          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(received, total);
          });
          res.on('aborted', () => {
            try { out.destroy(); } catch (_) { /* ignore */ }
            fail(new NasError('下载连接被中断。', 'ABORTED'));
          });
          res.on('error', (err) => {
            try { out.destroy(); } catch (_) { /* ignore */ }
            fail(err);
          });
          out.on('error', (err) => fail(err));
          out.on('finish', () => {
            if (finished) return;
            finished = true;
            if (received <= 0) {
              fail(new NasError('NAS 返回了空文件。', 'EMPTY'));
              return;
            }
            done({ bytes: received, contentType, total });
          });
          res.pipe(out);
        });

        req.setTimeout(c.timeoutMs, () => {
          req.destroy(new NasError('下载连接超时，请检查网络。', 'TIMEOUT'));
        });
        req.on('error', (err) => {
          if (err instanceof NasError) fail(err);
          else fail(new NasError(`下载失败：${err.code || err.message}`, 'NETWORK', err.message));
        });
        req.end();
      };

      log.info('FileStation 下载尝试:', nasPath);
      attempt(startUrl, 3);
    });
  }
}

module.exports = { NasClient, NasError, normalizeTime, normalizeSize, friendlyCode };
