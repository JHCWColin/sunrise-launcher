'use strict';

/**
 * 开发启动脚本：同时启动模拟 NAS 与 Electron（窗口模式，不隐藏任务栏）。
 * 用法：npm run dev
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const downloads = path.join(__dirname, 'mock-downloads');
fs.mkdirSync(downloads, { recursive: true });

const mock = spawn(process.execPath, [path.join(__dirname, 'mock-nas.js')], {
  cwd: root,
  env: { ...process.env, MOCK_PORT: process.env.MOCK_PORT || '5899' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ready = false;
let electron = null;

mock.stdout.on('data', (buf) => {
  const text = buf.toString('utf8');
  process.stdout.write(text);
  if (!ready && text.includes('MOCK_NAS_READY')) {
    ready = true;
    startElectron();
  }
});
mock.stderr.on('data', (buf) => process.stderr.write(buf));
mock.on('exit', (code) => {
  if (electron && !electron.killed) {
    try { electron.kill(); } catch (_) { /* ignore */ }
  }
  if (!ready) process.exit(code || 1);
});

function startElectron() {
  const electronPath = require('electron');
  const childEnv = {
    ...process.env,
    SUNRISE_DEV_WINDOW: '1',
    SUNRISE_DEV_SCALE: process.env.SUNRISE_DEV_SCALE || '1',
    SUNRISE_NAS_HOST: '127.0.0.1',
    SUNRISE_NAS_PORT: process.env.MOCK_PORT || '5899',
    SUNRISE_NAS_HTTPS: '0',
    SUNRISE_NAS_ALLOW_SELF_SIGNED: '0',
    SUNRISE_DOWNLOADS_DIR: downloads,
    SUNRISE_SKIP_INTRO: process.env.SUNRISE_SKIP_INTRO || '',
    SUNRISE_DEVTOOLS: process.env.SUNRISE_DEVTOOLS || '',
    SUNRISE_FAKE_APPS: process.env.SUNRISE_FAKE_APPS || '1',
  };
  // DSH / 某些终端会设置 ELECTRON_RUN_AS_NODE=1；不清除的话 Electron 会以纯 Node 运行。
  delete childEnv.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronPath, ['.'], {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
  });
  electron.on('exit', (code) => {
    console.log(`[dev] electron exited (${code})`);
    shutdown(code || 0);
  });
  electron.on('error', (err) => {
    console.error('[dev] electron failed:', err.message);
    shutdown(1);
  });
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (electron && !electron.killed) electron.kill(); } catch (_) { /* ignore */ }
  try { if (mock && !mock.killed) mock.kill(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

setTimeout(() => {
  if (!ready) {
    console.error('[dev] mock NAS did not start in time');
    shutdown(1);
  }
}, 8000);
