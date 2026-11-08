import { $, greetingForHour } from './ui.js';

let config = { clock24h: true, showSeconds: false };
let timer = null;
let interval = null;
let lunarFailed = false;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLunar(date) {
  if (lunarFailed) return '';
  try {
    const fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric',
    });
    const text = fmt.format(date);
    return text ? `农历${text}` : '';
  } catch (_) {
    lunarFailed = true;
    return '';
  }
}

export function updateClock() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();

  const greeting = document.getElementById('greeting');
  if (greeting) greeting.textContent = greetingForHour(hour);

  let hourText;
  let ampm = '';
  if (config.clock24h) {
    hourText = pad(hour);
  } else {
    const h12 = hour % 12 || 12;
    hourText = String(h12);
    ampm = hour < 12 ? '上午' : '下午';
  }

  const main = document.getElementById('clock-main');
  if (main) main.textContent = `${hourText}:${pad(minute)}`;

  const sub = document.getElementById('clock-sub');
  if (sub) {
    sub.textContent = `:${pad(second)}`;
    sub.classList.toggle('is-hidden', !config.showSeconds);
  }

  const ampmEl = document.getElementById('clock-ampm');
  if (ampmEl) ampmEl.textContent = ampm;

  const dateEl = document.getElementById('date-text');
  if (dateEl) dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;

  const weekEl = document.getElementById('weekday-text');
  if (weekEl) weekEl.textContent = `星期${'日一二三四五六'[now.getDay()]}`;

  const yearEl = document.getElementById('year-text');
  if (yearEl) yearEl.textContent = `${now.getFullYear()}年`;

  const lunarEl = document.getElementById('lunar-text');
  if (lunarEl) lunarEl.textContent = formatLunar(now);
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (interval) clearInterval(interval);
  updateClock();
  const delay = 1000 - (Date.now() % 1000);
  timer = setTimeout(() => {
    updateClock();
    interval = setInterval(updateClock, 1000);
  }, delay);
}

export function startClock(initialConfig) {
  if (initialConfig) config = { ...config, ...initialConfig };
  schedule();
}

export function setClockConfig(next) {
  config = { ...config, clock24h: next.clock24h !== false, showSeconds: Boolean(next.showSeconds) };
  updateClock();
}
