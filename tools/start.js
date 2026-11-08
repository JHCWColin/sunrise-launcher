'use strict';

/**
 * 直接以 Electron 主进程模式启动（默认全屏）。
 * 某些终端会设置 ELECTRON_RUN_AS_NODE=1，这里统一清除，避免 Electron 变成纯 Node。
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code || 0));
child.on('error', (err) => {
  console.error('[start] electron failed:', err.message);
  process.exit(1);
});
