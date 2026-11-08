import { $ } from './ui.js';

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
  };
}

export function playIntro({ developer, reduceMotion = false, skip = false, onDone }) {
  const intro = $('#intro');
  const devEl = $('#intro-dev');
  if (devEl && developer) devEl.textContent = developer;

  let finished = false;
  let autoTimer = null;
  let removeTimer = null;

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
    intro.classList.add('intro-leaving');
    intro.setAttribute('aria-hidden', 'true');
    const delay = reduceMotion ? 220 : 900;
    removeTimer = setTimeout(() => {
      intro.style.display = 'none';
      if (onDone) onDone();
    }, delay);
  };

  if (!intro) {
    if (onDone) onDone();
    return;
  }

  if (skip) {
    finished = true;
    intro.style.display = 'none';
    intro.setAttribute('aria-hidden', 'true');
    if (onDone) onDone();
    return;
  }

  const canvas = $('#intro-canvas');
  if (canvas && !reduceMotion) {
    const stop = startParticles(canvas);
    if (stop) cleanupFns.push(stop);
  }

  const skipButton = $('#intro-skip');
  if (skipButton) {
    const onClick = (event) => {
      event.stopPropagation();
      finish();
    };
    skipButton.addEventListener('click', onClick);
    cleanupFns.push(() => skipButton.removeEventListener('click', onClick));
  }

  const onPointer = () => {
    if (performance.now() < 700) return;
    finish();
  };
  intro.addEventListener('pointerdown', onPointer);
  cleanupFns.push(() => intro.removeEventListener('pointerdown', onPointer));

  const onKey = (event) => {
    if (['Enter', ' ', 'Escape'].includes(event.key)) finish();
  };
  window.addEventListener('keydown', onKey);
  cleanupFns.push(() => window.removeEventListener('keydown', onKey));

  const duration = reduceMotion ? 2200 : 6500;
  autoTimer = setTimeout(finish, duration);
}

export function stopIntro() {
  const intro = $('#intro');
  if (intro) {
    intro.classList.add('intro-leaving');
    setTimeout(() => { intro.style.display = 'none'; }, 300);
  }
}
