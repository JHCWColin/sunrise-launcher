import { $ } from './ui.js';
import { playDawnIntro } from './intro-dawn.js';
import { createIntroAudio } from './intro-audio.js';

/** 开场样式：dawn = v2.0「破晓」（默认），classic = 旧版「旭日」 */
export const INTRO_STYLES = ['dawn', 'classic'];

let raf = null;
let cleanupFns = [];

function startParticles(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let width = 0;
  let height = 0;
  let particles = [];

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(120, Math.max(45, Math.floor((width * height) / 26000)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: height * (0.2 + Math.random() * 0.8),
      r: 0.5 + Math.random() * 2.0,
      vy: 0.12 + Math.random() * 0.55,
      vx: -0.16 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.1,
      warm: Math.random() > 0.28,
    }));
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    const t = time / 1000;
    for (const p of particles) {
      p.x += p.vx * 0.35;
      p.y -= p.vy;
      if (p.y < -10) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase));
      const alpha = twinkle * 0.55;
      const color = p.warm ? `rgba(255, 205, 140, ${alpha})` : `rgba(220, 235, 255, ${alpha * 0.8})`;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.shadowColor = p.warm ? 'rgba(255, 170, 80, .8)' : 'rgba(160, 210, 255, .7)';
      ctx.shadowBlur = p.r * 5;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);
  return () => {
    window.removeEventListener('resize', resize);
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    try { ctx.clearRect(0, 0, width, height); } catch (_) { /* ignore */ }
  };
}

/** 旧版开场的配套音效：暖和弦渐强 + 标题逐字钟音，与 intro.css 的时间轴对齐。 */
function scheduleClassicSound(audio) {
  const { sfx, NOTE } = audio;
  const t0 = audio.now + 0.03;
  sfx.drone(t0, 6.8);
  sfx.pad(t0 + 0.5, 6.2, 0.05);
  [NOTE.D5, NOTE.Fs5, NOTE.A5, NOTE.D6].forEach((f, i) => sfx.bell(t0 + 1.55 + i * 0.14, f, 0.13, 2.6));
  sfx.bell(t0 + 2.75, NOTE.A4, 0.08, 2.4);
  sfx.sparkle(t0 + 2.95, 5, 0.04);
}

function playClassicIntro({ reduceMotion = false, sound = true, onDone }) {
  let intro = $('#intro');
  if (!intro) {
    if (onDone) onDone();
    return;
  }
  // 预览 / 重播：替换为一份克隆节点，CSS 动画会从头开始。
  if (intro.dataset.played) {
    const fresh = intro.cloneNode(true);
    fresh.classList.remove('intro-leaving');
    intro.replaceWith(fresh);
    intro = fresh;
  }
  intro.dataset.played = '1';
  intro.style.display = '';
  intro.removeAttribute('aria-hidden');
  intro.removeAttribute('data-pending');

  const startedAt = performance.now();
  let finished = false;
  let autoTimer = null;
  let removeTimer = null;
  let audio = null;
  if (sound) {
    audio = createIntroAudio({ volume: 0.55 });
    if (audio) {
      audio.resume();
      try { scheduleClassicSound(audio); } catch (_) { audio = null; }
    }
  }

  const cleanup = () => {
    cleanupFns.forEach((fn) => {
      try { fn(); } catch (_) { /* ignore */ }
    });
    cleanupFns = [];
    if (autoTimer) clearTimeout(autoTimer);
    if (removeTimer) clearTimeout(removeTimer);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (audio) audio.stop(0.9);
    intro.classList.add('intro-leaving');
    intro.setAttribute('aria-hidden', 'true');
    const delay = reduceMotion ? 220 : 900;
    removeTimer = setTimeout(() => {
      intro.style.display = 'none';
      if (onDone) onDone();
    }, delay);
  };

  const canvas = $('#intro-canvas');
  if (canvas && !reduceMotion) {
    const stop = startParticles(canvas);
    if (stop) cleanupFns.push(stop);
  }

  const onPointer = () => {
    if (performance.now() - startedAt < 700) return;
    finish();
  };
  intro.addEventListener('pointerdown', onPointer);
  cleanupFns.push(() => intro.removeEventListener('pointerdown', onPointer));

  const onKey = (event) => {
    if (['Enter', ' ', 'Escape'].includes(event.key)) finish();
  };
  window.addEventListener('keydown', onKey);
  cleanupFns.push(() => window.removeEventListener('keydown', onKey));

  const duration = reduceMotion ? 2200 : 5500;
  autoTimer = setTimeout(finish, duration);
}

/**
 * 播放开场动画。
 * @param {object} opts
 * @param {'dawn'|'classic'} [opts.style] 开场样式，默认 dawn（v2.0「破晓」）
 * @param {boolean} [opts.sound] 是否播放开场音效
 * @param {boolean} [opts.skip] 跳过开场，直接进入桌面
 * @param {string} [opts.version] 版本号，显示在「破晓」眉题里
 */
export function playIntro({
  reduceMotion = false, skip = false, style = 'dawn', sound = true, version = '', onDone,
} = {}) {
  const classic = $('#intro');
  const dawn = $('#intro-dawn');

  if (skip) {
    [classic, dawn].forEach((el) => {
      if (!el) return;
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    });
    if (onDone) onDone();
    return;
  }

  if (style === 'classic' || !dawn) {
    if (dawn) dawn.hidden = true;
    playClassicIntro({ reduceMotion, sound, onDone });
    return;
  }

  playDawnIntro({ reduceMotion, sound, version, onDone });
  // 「破晓」覆盖在旧版之上；等它的第一帧画出来后再收起旧版黑底，避免闪烁。
  if (classic) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      classic.style.display = 'none';
      classic.setAttribute('aria-hidden', 'true');
    }));
  }
}

export function stopIntro() {
  const intro = $('#intro');
  if (intro) {
    intro.classList.add('intro-leaving');
    setTimeout(() => { intro.style.display = 'none'; }, 300);
  }
}
