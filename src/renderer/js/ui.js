import { ICON } from './icons.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSecond) {
  const n = Number(bytesPerSecond);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${formatBytes(n)}/s`;
}

export function formatFileTime(ms) {
  const n = Number(ms);
  if (!n) return '—';
  const date = new Date(n);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function relativeTime(ms) {
  const n = Number(ms);
  if (!n) return '';
  const diff = Date.now() - n;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  const date = new Date(n);
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function greetingForHour(hour) {
  if (hour < 5) return '夜深了，老师';
  if (hour < 9) return '早上好，老师';
  if (hour < 12) return '上午好，老师';
  if (hour < 14) return '中午好，老师';
  if (hour < 18) return '下午好，老师';
  if (hour < 23) return '晚上好，老师';
  return '夜深了，老师';
}

export function debounce(fn, wait = 200) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#eaf0f7' : '#04060a');
}

export function applyAccent(accent) {
  document.documentElement.setAttribute('data-accent', accent || 'sunrise');
}

export function applyGlass(value) {
  const scale = Math.min(1.6, Math.max(0.35, Number(value) || 1));
  document.documentElement.style.setProperty('--glass-scale', String(scale));
}

export function applyMotion(reduce) {
  document.documentElement.setAttribute('data-reduce-motion', reduce ? 'true' : 'false');
}

export function iconOf(name) {
  return ICON[name] || ICON.info;
}

export function setIcon(element, name) {
  if (!element) return;
  element.innerHTML = iconOf(name);
}

export function toast(payload) {
  const layer = document.getElementById('toast-layer');
  if (!layer) return () => {};
  const options = typeof payload === 'string' ? { message: payload } : (payload || {});
  const type = options.type || 'info';
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'warning' : type === 'warning' ? 'warning' : 'info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${iconOf(iconName)}</span>
    <span class="toast-text"></span>
    ${options.actionLabel ? '<button class="toast-action" type="button"></button>' : ''}
    <button class="toast-close" type="button" aria-label="关闭">${ICON.close}</button>
  `;
  el.querySelector('.toast-text').textContent = options.message || '';
  const close = () => {
    if (el.classList.contains('is-out')) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 340);
  };
  el.querySelector('.toast-close').addEventListener('click', close);
  if (options.actionLabel) {
    const action = el.querySelector('.toast-action');
    action.textContent = options.actionLabel;
    action.addEventListener('click', () => {
      try { options.onAction && options.onAction(); } catch (_) { /* ignore */ }
      close();
    });
  }
  layer.appendChild(el);
  const existing = Array.from(layer.children);
  while (existing.length > 4) {
    existing.shift().remove();
  }
  const duration = Number(options.duration) || 3800;
  let timer = setTimeout(close, duration);
  el.addEventListener('mouseenter', () => {
    clearTimeout(timer);
  });
  el.addEventListener('mouseleave', () => {
    timer = setTimeout(close, 1800);
  });
  return close;
}

let activeModalClose = null;

export function closeActiveModal() {
  if (activeModalClose) activeModalClose();
}

export function openModal({ title, message = '', icon = 'info', danger = false, actions = [], content = '', onMount }) {
  if (activeModalClose) activeModalClose();
  return new Promise((resolve) => {
    const layer = document.getElementById('modal-layer');
    if (!layer) {
      resolve(null);
      return;
    }
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      <div class="modal-icon ${danger ? 'danger' : ''}">${iconOf(icon)}</div>
      <h3></h3>
      ${message ? '<p class="modal-message"></p>' : ''}
      <div class="modal-content"></div>
      <div class="modal-actions"></div>
    `;
    box.querySelector('h3').textContent = title || '';
    if (message) box.querySelector('.modal-message').textContent = message;
    const contentEl = box.querySelector('.modal-content');
    if (content) contentEl.innerHTML = content;
    const actionWrap = box.querySelector('.modal-actions');
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKey);
      if (activeModalClose === closeFn) activeModalClose = null;
      layer.classList.add('is-hidden');
      layer.innerHTML = '';
      resolve(value);
    };
    const closeFn = () => finish(null);
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    };
    window.addEventListener('keydown', onKey);
    activeModalClose = closeFn;

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.style === 'primary' ? 'primary-btn'
        : action.style === 'danger' ? 'danger-btn'
          : 'ghost-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', () => finish(action.value));
      actionWrap.appendChild(btn);
    }
    if (!actions.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary-btn';
      btn.textContent = '知道了';
      btn.addEventListener('click', () => finish('ok'));
      actionWrap.appendChild(btn);
    }

    layer.innerHTML = '';
    layer.appendChild(box);
    layer.classList.remove('is-hidden');
    box.tabIndex = -1;
    if (onMount) {
      try { onMount(box, finish); } catch (_) { /* ignore */ }
    }
    requestAnimationFrame(() => box.focus());
  });
}

export async function confirmDialog({ title, message, confirmLabel = '确定', cancelLabel = '取消', danger = false, icon = 'info' }) {
  const result = await openModal({
    title,
    message,
    icon,
    danger,
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, value: true, style: danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}

export function initCursorIdle() {
  let timer = null;
  const reset = () => {
    document.body.classList.remove('cursor-idle');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add('cursor-idle'), 5000);
  };
  window.addEventListener('pointermove', reset, { passive: true });
  window.addEventListener('pointerdown', reset, { passive: true });
  window.addEventListener('keydown', reset, { passive: true });
  reset();
}

export function ripple(event, element, tone = 'rgba(255,255,255,.18)') {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 0.6;
  const x = (event.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (event.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
  const span = document.createElement('span');
  span.className = 'click-ripple';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  span.style.background = `radial-gradient(circle, ${tone}, transparent 70%)`;
  element.appendChild(span);
  setTimeout(() => span.remove(), 650);
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch (_) { /* ignore */ }
}

export function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('is-busy', Boolean(busy));
  button.disabled = Boolean(busy);
}
