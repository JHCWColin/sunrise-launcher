import api from './api.js';
import { ICON } from './icons.js';
import { $, formatBytes, setIcon, toast } from './ui.js';

let dom = {};
let currentPath = '';
let open = false;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
const pointers = new Map();
let pinchStart = 0;
let pinchScale = 1;
let dragging = false;
let dragStart = null;

function cacheDom() {
  dom.viewer = $('#image-viewer');
  dom.img = $('#viewer-img');
  dom.name = $('#viewer-name');
  dom.meta = $('#viewer-meta');
  dom.loading = $('#viewer-loading');
  dom.error = $('#viewer-error');
  dom.errorText = $('#viewer-error-text');
  dom.close = $('#viewer-close');
  dom.reveal = $('#viewer-reveal');
  dom.stage = $('#viewer-stage');
}

function applyTransform() {
  if (!dom.img) return;
  dom.img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function resetTransform() {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  applyTransform();
}

function setLoading(loading) {
  if (dom.loading) dom.loading.classList.toggle('is-hidden', !loading);
}

function showError(message) {
  if (dom.loading) dom.loading.classList.add('is-hidden');
  if (dom.error) dom.error.classList.remove('is-hidden');
  if (dom.errorText) dom.errorText.textContent = message || '可以尝试在文件夹中打开。';
  if (dom.img) {
    dom.img.removeAttribute('src');
    dom.img.classList.remove('is-loaded');
  }
}

function bindZoom() {
  if (!dom.stage) return;
  dom.stage.addEventListener('wheel', (event) => {
    if (!open) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    scale = Math.min(5, Math.max(0.6, scale * factor));
    if (scale <= 1) {
      offsetX = 0;
      offsetY = 0;
    }
    applyTransform();
  }, { passive: false });

  dom.stage.addEventListener('dblclick', (event) => {
    if (!open) return;
    event.preventDefault();
    if (scale > 1.05) {
      resetTransform();
    } else {
      scale = 2.2;
      const rect = dom.stage.getBoundingClientRect();
      offsetX = (rect.width / 2 - event.clientX) * 0.6;
      offsetY = (rect.height / 2 - event.clientY) * 0.6;
      applyTransform();
    }
  });

  dom.stage.addEventListener('pointerdown', (event) => {
    if (!open) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { dom.stage.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      pinchScale = scale;
      dragging = false;
      dragStart = null;
    } else if (pointers.size === 1 && scale > 1.02) {
      dragging = true;
      dragStart = { x: event.clientX - offsetX, y: event.clientY - offsetY };
    }
  });

  dom.stage.addEventListener('pointermove', (event) => {
    if (!open || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinchStart > 0) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      scale = Math.min(5, Math.max(0.6, pinchScale * (dist / pinchStart)));
      applyTransform();
      return;
    }
    if (dragging && dragStart) {
      offsetX = event.clientX - dragStart.x;
      offsetY = event.clientY - dragStart.y;
      applyTransform();
    }
  });

  const end = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      dragStart = null;
      pinchStart = 0;
      if (scale < 1) {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        applyTransform();
      }
    } else if (pointers.size === 1 && scale > 1.02) {
      const point = Array.from(pointers.values())[0];
      dragging = true;
      dragStart = { x: point.x - offsetX, y: point.y - offsetY };
    }
  };
  dom.stage.addEventListener('pointerup', end);
  dom.stage.addEventListener('pointercancel', end);
  dom.stage.addEventListener('pointerleave', end);
}

function bind() {
  if (dom.close) dom.close.addEventListener('click', () => closeImageViewer());
  if (dom.reveal) {
    dom.reveal.addEventListener('click', async () => {
      if (!currentPath) return;
      const result = await api.revealFile(currentPath);
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法定位文件' });
    });
  }
  if (dom.stage) {
    dom.stage.addEventListener('click', (event) => {
      if (event.target === dom.stage && !dragging) closeImageViewer();
    });
  }
  bindZoom();
}

export function initImageViewer() {
  cacheDom();
  if (dom.close) setIcon(dom.close, 'close');
  if (dom.reveal) setIcon(dom.reveal, 'external');
  bind();
  if (dom.img) {
    dom.img.addEventListener('load', () => {
      setLoading(false);
      dom.img.classList.add('is-loaded');
    });
    dom.img.addEventListener('error', () => {
      showError('图片解码失败，可以尝试在文件夹中打开。');
    });
  }
}

export async function openImageViewer({ path, name, size }) {
  if (!dom.viewer) {
    api.log('error', 'image viewer DOM missing');
    return;
  }
  api.log('info', `openImageViewer ${path}`);
  currentPath = path;
  open = true;
  resetTransform();
  if (dom.name) dom.name.textContent = name || '图片';
  if (dom.meta) {
    dom.meta.textContent = [size ? formatBytes(size) : '', '图片预览'].filter(Boolean).join(' · ');
  }
  setLoading(true);
  if (dom.error) dom.error.classList.add('is-hidden');
  if (dom.img) {
    dom.img.classList.remove('is-loaded');
    dom.img.removeAttribute('src');
  }
  dom.viewer.classList.remove('is-hidden');
  dom.viewer.classList.add('is-open');
  dom.viewer.setAttribute('aria-hidden', 'false');

  try {
    const result = await api.readImage(path);
    if (!open || currentPath !== path) return;
    if (!result || !result.ok) {
      showError((result && result.message) || '无法读取图片');
      return;
    }
    if (dom.img) {
      dom.img.src = result.dataUrl;
      dom.img.alt = name || '图片';
    }
  } catch (err) {
    showError(err.message || '无法读取图片');
  }
}

export function closeImageViewer() {
  if (!open || !dom.viewer) return;
  open = false;
  dom.viewer.classList.remove('is-open');
  dom.viewer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    if (!open && dom.viewer) dom.viewer.classList.add('is-hidden');
  }, 420);
  if (dom.img) {
    dom.img.removeAttribute('src');
    dom.img.classList.remove('is-loaded');
  }
  currentPath = '';
  resetTransform();
}

export function isImageViewerOpen() {
  return open;
}

export function refreshViewerIcons() {
  if (dom.close) setIcon(dom.close, 'close');
  if (dom.reveal) setIcon(dom.reveal, 'external');
}
