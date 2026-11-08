'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('./logger');

let guard = null;
let stopFile = '';
let stopping = false;

function scriptsDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'scripts');
  return path.join(__dirname, '..', '..', 'resources', 'scripts');
}

function psExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function shouldSkip() {
  return process.env.SUNRISE_DEV_WINDOW === '1'
    || process.env.SUNRISE_NO_TASKBAR_HIDE === '1';
}

function start() {
  if (shouldSkip()) {
    log.info('开发窗口模式：跳过任务栏隐藏');
    return;
  }
  if (guard) return;

  stopFile = path.join(app.getPath('temp'), `sunrise-taskbar-${process.pid}.stop`);
  try { fs.rmSync(stopFile, { force: true }); } catch (_) { /* ignore */ }

  const script = path.join(scriptsDir(), 'taskbar-guard.ps1');
  if (!fs.existsSync(script)) {
    log.error('任务栏守护脚本不存在:', script);
    return;
  }

  const guardLog = path.join(app.getPath('temp'), `sunrise-taskbar-${process.pid}.log`);
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', script,
    '-ParentPid', String(process.pid),
    '-StopFile', stopFile,
    '-LogFile', guardLog,
  ];

  log.info('启动任务栏守护，PID:', process.pid);
  // 守护进程会监视主进程 PID；主进程正常退出或消失后恢复任务栏。
  guard = spawn(psExe(), args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  guard.stdout.on('data', (buf) => {
    const text = buf.toString('utf8').trim();
    if (text) log.info('[taskbar]', text);
  });
  guard.stderr.on('data', (buf) => {
    const text = buf.toString('utf8').trim();
    if (text) log.warn('[taskbar]', text);
  });
  guard.on('exit', (code) => {
    log.info('任务栏守护退出，code=', code, '日志:', guardLog);
    guard = null;
  });
  guard.on('error', (err) => {
    log.error('任务栏守护启动失败:', err.message);
    guard = null;
  });
}

function restore() {
  return new Promise((resolve) => {
    if (shouldSkip()) {
      resolve(true);
      return;
    }
    if (stopping) {
      resolve(true);
      return;
    }
    stopping = true;

    try {
      if (stopFile) fs.writeFileSync(stopFile, 'stop', 'utf8');
    } catch (_) { /* ignore */ }

    const child = guard;
    if (!child) {
      runRestoreScript().finally(() => resolve(true));
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
      runRestoreScript().finally(finish);
    }, 2200);

    child.once('exit', () => {
      clearTimeout(timer);
      // 守护脚本自身会在 finally 里恢复；再补一次还原，确保万无一失。
      runRestoreScript().finally(finish);
    });
  });
}

function runRestoreScript() {
  return new Promise((resolve) => {
    const script = path.join(scriptsDir(), 'taskbar-guard.ps1');
    if (!fs.existsSync(script)) {
      resolve();
      return;
    }
    const child = spawn(psExe(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', script,
      '-Restore',
    ], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
      resolve();
    }, 2500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.once('error', () => { clearTimeout(timer); resolve(); });
  });
}

module.exports = { start, restore, scriptsDir };
