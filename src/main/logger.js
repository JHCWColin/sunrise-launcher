'use strict';

const fs = require('fs');
const path = require('path');

let logDir = '';
let logFile = '';
let ready = false;

function init(userDataDir) {
  logDir = path.join(userDataDir, 'logs');
  logFile = path.join(logDir, 'main.log');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      const old = `${logFile}.1`;
      try { fs.rmSync(old, { force: true }); } catch (_) { /* ignore */ }
      fs.renameSync(logFile, old);
    }
  } catch (_) { /* logging must never crash the app */ }
  ready = true;
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function redact(value) {
  if (value === null || value === undefined) return value;
  let text = value instanceof Error ? `${value.message}\n${value.stack || ''}` : String(value);
  text = text.replace(/(passwd|password|pass|sid|synotoken|SynoToken)([=:]\s*)[^\s&,;]+/gi, '$1$2***');
  return text;
}

function write(level, args) {
  if (!ready) return;
  const line = `[${stamp()}] [${level}] ${args.map(redact).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) { /* ignore */ }
  if (level === 'ERROR') {
    try { process.stderr.write(line); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  init,
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => write('DEBUG', a),
  logDir: () => logDir,
};
