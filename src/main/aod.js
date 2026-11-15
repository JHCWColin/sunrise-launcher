'use strict';

/**
 * v1.9.0 自动熄屏常显（Always-on Display）主进程控制器。
 *
 * 职责：每秒读取一次系统级空闲时间（powerMonitor.getSystemIdleTime()，
 * Windows 底层为 GetLastInputInfo，统计的是整个系统的键鼠/触摸输入，
 * 即使焦点在 WPS、希沃白板等其他窗口里也会被计入）：
 *
 *  - 空闲时间 >= aodTimeoutSec 且 AOD 未激活 → 通知渲染进程进入熄屏界面；
 *  - AOD 激活期间系统出现任何输入（空闲时间回落） → 通知渲染进程唤醒。
 *    这样即使用户正在操作覆盖在本软件之上的其他程序（如 WPS 放课件），
 *    熄屏层也不会在背后悄悄挂起，关闭那些程序时看到的永远是正常桌面。
 *
 * 渲染进程自身还在熄屏层上监听 pointerdown / keydown，轻点任意位置
 * 立即唤醒（不必等下一次轮询），两边通过 'aod:state' 事件对齐状态。
 */

const { powerMonitor } = require('electron');
const log = require('./logger');

const POLL_INTERVAL_MS = 1000;
// AOD 激活期间，空闲时间回落到该阈值以下视为「出现了新的输入」。
const ACTIVITY_IDLE_THRESHOLD_SEC = 2;

function createAodController({ send }) {
  let timer = null;
  let active = false;
  let getConfig = () => null;

  function enter() {
    active = true;
    log.info('AOD: 进入熄屏常显');
    send('aod:state', { active: true });
  }

  function exit(reason) {
    if (!active) return;
    active = false;
    log.info('AOD: 唤醒（' + reason + '）');
    send('aod:state', { active: false });
  }

  function tick() {
    const config = getConfig();
    if (!config) return;
    if (!config.aodEnabled) {
      exit('已关闭');
      return;
    }
    let idleSec = 0;
    try {
      idleSec = powerMonitor.getSystemIdleTime();
    } catch (err) {
      log.warn('AOD: 读取系统空闲时间失败:', err.message);
      return;
    }
    if (!active) {
      if (idleSec >= config.aodTimeoutSec) enter();
    } else if (idleSec <= ACTIVITY_IDLE_THRESHOLD_SEC) {
      exit('检测到输入');
    }
  }

  function start(getCfg) {
    if (typeof getCfg === 'function') getConfig = getCfg;
    if (timer) clearInterval(timer);
    timer = setInterval(tick, POLL_INTERVAL_MS);
    log.info('AOD: 空闲监测已启动');
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    exit('退出软件');
  }

  // 渲染进程轻点屏幕后的即时唤醒请求（不等下一次轮询）。
  function wake() {
    exit('轻点唤醒');
  }

  return {
    start,
    stop,
    wake,
    isActive: () => active,
  };
}

module.exports = { createAodController };
