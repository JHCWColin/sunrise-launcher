import api from './api.js';

/**
 * v1.9.5 iPhone 风格自动熄屏常显（AOD）渲染层。
 *
 * - 主进程监测系统空闲时间，通过 'aod:state' 通知进入 / 退出熄屏；
 * - 熄屏时：壁纸亮度降到约四分之一（v1.9.5 起改为遮罩透明度过渡来
 *   「调暗壁纸」，不再是近似纯黑的幕布，壁纸始终隐约可辨），大号数字
 *   时钟位于屏幕正中，公历 / 农历两行日期紧贴其上，整组落在屏幕中间
 *   偏上（全部苹方字体、统一略带透明），底部提示「轻点任意位置解锁」；
 * - 进入 / 退出熄屏都带淡入淡出 + 一点点缩放的动画（见 aod.css）：
 *   壁纸组 1.02 → 1.06 呼吸缩放，熄屏内容 0.94 → 1 缩放浮现；
 * - 轻点屏幕任意位置或按任意键立即唤醒；
 * - 公历行：yyyy年mm月dd日 星期几；
 * - 农历行：干支年 + 汉字农历月 + 汉字农历日（如「丙午年十月初四日」），
 *   由 Chromium 内置的中国传统历法（Intl 'zh-CN-u-ca-chinese'）换算，
 *   跨春节边界自动按农历年取干支，闰月同样正确。
 */

const LUNAR_DAYS = (() => {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const table = [''];
  for (let d = 1; d <= 10; d += 1) table.push(`初${digits[d]}`);
  for (let d = 11; d <= 19; d += 1) table.push(`十${digits[d - 10]}`);
  table.push('二十');
  for (let d = 21; d <= 29; d += 1) table.push(`廿${digits[d - 20]}`);
  table.push('三十');
  return table;
})();

const WEEKDAY_TEXT = ['日', '一', '二', '三', '四', '五', '六'];

let active = false;
let timer = null;
let clock24h = true;
let lunarFailed = false;

function pad(value) {
  return String(value).padStart(2, '0');
}

let lunarFmt = null;
let yearFmt = null;

function ensureLunarFormatters() {
  if (lunarFmt) return;
  lunarFmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
  yearFmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric' });
}

// 干支年（如「丙午」）。ICU 会把农历年份格式化成「2026丙午年」，
// formatToParts 里拆出 relatedYear（公历年）与 yearName（干支名）。
function ganzhiYearOf(date) {
  ensureLunarFormatters();
  const parts = yearFmt.formatToParts(date);
  const yearName = parts.find((p) => p.type === 'yearName');
  if (yearName && yearName.value) return yearName.value;
  const text = yearFmt.format(date);
  const match = text.match(/([\u4e00-\u9fff]{2})\s*年/);
  return match ? match[1] : '';
}

// 汉字农历日期，如「十月」+「初四」。农历月 Intl 直接给出汉字（正月 / 腊月 / 闰X月），
// 日是阿拉伯数字，这里转成 初X / 十X / 廿X / 三十 的传统写法。
function lunarTextOf(date) {
  if (lunarFailed) return '';
  try {
    ensureLunarFormatters();
    const parts = lunarFmt.formatToParts(date);
    let month = '';
    let day = 0;
    for (const part of parts) {
      if (part.type === 'month') month = part.value;
      if (part.type === 'day') day = Number(part.value) || 0;
    }
    if (!month || !day || !LUNAR_DAYS[day]) return '';
    // ICU 的农历月自带「月」字（如「十月」「腊月」「闰六月」），没有时再补上。
    const monthText = /月$/.test(month) ? month : `${month}月`;
    return `${monthText}${LUNAR_DAYS[day]}日`;
  } catch (_) {
    lunarFailed = true;
    return '';
  }
}

function render() {
  const now = new Date();

  const line1 = document.getElementById('aod-date-line1');
  if (line1) {
    line1.textContent = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${WEEKDAY_TEXT[now.getDay()]}`;
  }

  const line2 = document.getElementById('aod-date-line2');
  if (line2) {
    const lunar = lunarTextOf(now);
    const ganzhi = lunarFailed ? '' : ganzhiYearOf(now);
    line2.textContent = lunar && ganzhi ? `${ganzhi}年${lunar}` : lunar || `${now.getFullYear()}年`;
    line2.classList.toggle('is-hidden', !lunar);
  }

  const clock = document.getElementById('aod-clock');
  if (clock) {
    let hour = now.getHours();
    if (!clock24h) hour = hour % 12 || 12;
    const text = clock24h
      ? `${pad(hour)}:${pad(now.getMinutes())}`
      : `${hour}:${pad(now.getMinutes())}`;
    if (clock.textContent !== text) clock.textContent = text;
  }
}

function startTimer() {
  stopTimer();
  render();
  const delay = 1000 - (Date.now() % 1000);
  timer = setTimeout(() => {
    render();
    timer = setInterval(render, 1000);
  }, delay);
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function wake() {
  if (!active) return;
  // 本地立即退出熄屏（不等主进程下一秒轮询），同时让主进程同步状态。
  setActive(false);
  if (api && api.aodWake) api.aodWake().catch(() => {});
}

function setActive(next) {
  if (active === next) return;
  active = next;
  const layer = document.getElementById('aod-layer');
  if (!layer) return;
  if (next) {
    layer.classList.add('is-active');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('aod-active');
    startTimer();
  } else {
    layer.classList.remove('is-active');
    layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('aod-active');
    stopTimer();
  }
}

export function isAodActive() {
  return active;
}

export function initAod(config) {
  clock24h = !config || config.clock24h !== false;
  const layer = document.getElementById('aod-layer');
  if (layer) {
    // 轻点任意位置唤醒：pointerdown 覆盖触摸与鼠标，比 click 响应更快。
    layer.addEventListener('pointerdown', () => {
      wake();
    });
  }
  // 熄屏时按任意键也唤醒；用捕获阶段拦截，避免 Escape 顺带关闭底下的抽屉。
  window.addEventListener('keydown', (event) => {
    if (!active) return;
    event.stopPropagation();
    wake();
  }, true);

  if (api && api.onAodState) {
    api.onAodState((payload) => {
      setActive(Boolean(payload && payload.active));
    });
  }
}

export function setAodClockConfig(next) {
  clock24h = !next || next.clock24h !== false;
  if (active) render();
}
