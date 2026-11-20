/**
 * 「破晓」开场动画（v2.0 新增，默认开场）。
 *
 * 叙事：黑暗中光尘向中心汇聚 → 一团橙色星火被点燃（冲击波 + 火星迸发）
 *      → 星火坠向地平线，点亮一条贯穿屏幕的光线 → 旭日自地平线升起，
 *      天空被染成暖橙、海面泛起倒影 → 标题「旭日东升」逐字浮现、标语打字般写出、
 *      功能标签依次点亮 → 署名：JHCWColin、DeepSeek 与 Claude（星火再次闪耀）→ 进入桌面。
 *
 * 性能：画布按「不超过 1920 像素宽」的内部分辨率渲染再由 CSS 拉伸，
 * 光晕全部用径向渐变绘制（无 CSS blur 滤镜），4K 一体机上同样流畅。
 */
import { $ } from './ui.js';
import { APP_ICON, ICON } from './icons.js';
import { createIntroAudio } from './intro-audio.js';

/** 时间轴（秒） */
export const DAWN = {
  IGNITE: 1.7, // 星火点燃
  DROP0: 2.45, // 星火开始坠落
  DROP1: 2.95, // 触及地平线
  HZ0: 2.9, // 地平线展开
  HZ1: 4.1,
  RISE0: 3.0, // 太阳升起
  RISE1: 7.0,
  CLAUDE: 8.5, // Claude 星火在署名处闪耀
  END: 11.8, // 自动离场
  EXIT: 1.0, // 离场时长
};

const TAU = Math.PI * 2;
const CLAUDE_ORANGE = '#d97757';
const PALETTE = ['255, 214, 150', '255, 176, 104', '217, 119, 87', '255, 238, 208', '240, 150, 96'];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const easeInCubic = (k) => k * k * k;
const easeOutExpo = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const easeOutBack = (k) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
};
const smooth = (a, b, v) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/* ------------------------------------------------------------------
 * Claude 星火：12 道长短不一、末端圆润的光芒，围绕一个圆心。
 * 同一份路径既用于署名处的 SVG，也用于画布上的点燃动画。
 * ------------------------------------------------------------------ */
const SPARK_RAYS = [
  [0, 46], [29, 37], [61, 44], [90, 35], [118, 47], [151, 38],
  [180, 45], [209, 36], [240, 46], [270, 37], [298, 43], [331, 39],
];

function rayPath(angleDeg, len) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pt = (x, y) => `${(50 + x * cos - y * sin).toFixed(2)} ${(50 + x * sin + y * cos).toFixed(2)}`;
  const r0 = 4;
  const w0 = 4.4;
  const w1 = 1.9;
  return `M${pt(r0, -w0)} L${pt(len, -w1)} Q${pt(len + w1 * 1.9, 0)} ${pt(len, w1)} L${pt(r0, w0)} Z`;
}

const SPARK_RAY_PATHS = SPARK_RAYS.map(([a, l]) => rayPath(a, l));
const SPARK_CORE = 'M58.5 50 A8.5 8.5 0 1 0 41.5 50 A8.5 8.5 0 1 0 58.5 50 Z';
const SPARK_D = `${SPARK_RAY_PATHS.join(' ')} ${SPARK_CORE}`;

export function claudeSparkSvg(className = '') {
  const rays = SPARK_RAY_PATHS
    .map((d, i) => `<path class="spark-ray" style="--r:${i}" d="${d}"/>`)
    .join('');
  return `<svg class="${className}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<g fill="${CLAUDE_ORANGE}">${rays}<path class="spark-core" d="${SPARK_CORE}"/></g></svg>`;
}

/* ------------------------------------------------------------------
 * 画布场景
 * ------------------------------------------------------------------ */
function createScene(canvas, { still = false } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  const rand = Math.random;
  const sparkPath = new Path2D(SPARK_D);

  let W = 0;
  let H = 0;
  let u = 1;
  let cx = 0;
  let cy = 0;
  let hy = 0;
  let R = 0;
  let diag = 0;
  let lastT = 0;
  let exitAt = Infinity;
  let ignited = false;
  let emberClock = 0;

  const gather = Array.from({ length: 210 }, () => ({
    a: rand() * TAU,
    d: 0.3 + rand() * 0.78,
    start: rand() * 0.5,
    arrive: DAWN.IGNITE - 0.02 - rand() * 0.34,
    spin: (0.9 + rand() * 1.7) * (rand() < 0.5 ? -1 : 1),
    size: 0.7 + rand() * 1.8,
    c: PALETTE[(rand() * PALETTE.length) | 0],
  }));
  const stars = Array.from({ length: 140 }, () => ({
    x: rand(),
    y: rand() * 0.72,
    s: 0.6 + rand() * 1.4,
    ph: rand() * TAU,
    sp: 0.6 + rand() * 1.9,
  }));
  const coronaRays = Array.from({ length: 56 }, (_, i) => ({
    a: (i / 56) * TAU + (rand() - 0.5) * 0.08,
    l: 1.5 + rand() * 2.8,
    w: 0.006 + rand() * 0.018,
    ph: rand() * TAU,
  }));
  const sparks = [];
  const embers = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    // 内部分辨率封顶 1920 宽：柔光类画面放大几乎无损，4K 下省掉 3/4 像素填充。
    const scale = Math.min(window.devicePixelRatio || 1, 1.25, 1920 / Math.max(1, W));
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    u = Math.min(W, H) / 1080;
    cx = W / 2;
    cy = H * 0.4;
    hy = H * 0.745;
    R = Math.min(H * 0.108, W * 0.078);
    diag = Math.hypot(W, H);
  }

  function burst(x, y, count, power = 1) {
    for (let i = 0; i < count; i += 1) {
      const ang = rand() * TAU;
      const sp = (80 + rand() * 560) * u * power;
      sparks.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        age: 0,
        life: 0.9 + rand() * 1.9,
        size: (0.7 + rand() * 2.0) * u,
        c: PALETTE[(rand() * PALETTE.length) | 0],
        drag: 1.3 + rand() * 1.5,
      });
    }
  }

  function radial(x, y, r0, r1, stops) {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(x - r1, y - r1, r1 * 2, r1 * 2);
  }

  function drawSpark(x, y, size, rot, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 50, size / 50);
    ctx.translate(-50, -50);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = CLAUDE_ORANGE;
    ctx.fill(sparkPath);
    // 炽热内核
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(50, 50);
    ctx.scale(0.5, 0.5);
    ctx.translate(-50, -50);
    ctx.fillStyle = 'rgba(255, 210, 160, 0.42)';
    ctx.fill(sparkPath);
    ctx.restore();
  }

  function draw(t) {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;

    // ---------- 底色 ----------
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0807';
    ctx.fillRect(0, 0, W, H);

    const rise = easeOutCubic(clamp01((t - DAWN.RISE0) / (DAWN.RISE1 - DAWN.RISE0)));
    const sunK = smooth(DAWN.RISE0, DAWN.RISE0 + 2.4, t);
    const sunY = lerp(hy + R * 1.3, hy - R * 0.08, rise) - Math.max(0, t - DAWN.RISE1) * R * 0.015;
    const hz = clamp01((t - DAWN.HZ0) / (DAWN.HZ1 - DAWN.HZ0));

    ctx.globalCompositeOperation = 'lighter';

    // ---------- 天空晨光 ----------
    if (sunK > 0.001) {
      const g = ctx.createLinearGradient(0, hy - H * 0.82, 0, hy);
      g.addColorStop(0, 'rgba(110, 46, 30, 0)');
      g.addColorStop(0.5, `rgba(112, 48, 32, ${0.14 * sunK})`);
      g.addColorStop(0.84, `rgba(206, 102, 62, ${0.3 * sunK})`);
      g.addColorStop(1, `rgba(255, 168, 100, ${0.52 * sunK})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, hy);
      radial(cx, sunY, 0, R * 7.8, [
        [0, `rgba(255, 168, 92, ${0.44 * sunK})`],
        [0.42, `rgba(217, 119, 87, ${0.13 * sunK})`],
        [1, 'rgba(217, 119, 87, 0)'],
      ]);
    }

    // ---------- 星尘 ----------
    const starA = smooth(0.1, 1.3, t) * (1 - 0.82 * sunK);
    if (starA > 0.01) {
      for (const s of stars) {
        const a = starA * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
        ctx.fillStyle = `rgba(255, 236, 214, ${(a * 0.75).toFixed(3)})`;
        const sz = s.s * u;
        ctx.fillRect(s.x * W, s.y * H, sz, sz);
      }
    }

    // ---------- 日冕光芒 ----------
    if (sunK > 0.001) {
      ctx.beginPath();
      for (const r of coronaRays) {
        const ang = r.a + t * 0.028;
        const len = R * r.l * (0.82 + 0.18 * Math.sin(t * 1.15 + r.ph));
        ctx.moveTo(cx, sunY);
        ctx.lineTo(cx + Math.cos(ang - r.w) * len, sunY + Math.sin(ang - r.w) * len);
        ctx.lineTo(cx + Math.cos(ang + r.w) * len, sunY + Math.sin(ang + r.w) * len);
        ctx.closePath();
      }
      const g = ctx.createRadialGradient(cx, sunY, R * 0.7, cx, sunY, R * 4.6);
      g.addColorStop(0, `rgba(255, 200, 136, ${0.3 * sunK})`);
      g.addColorStop(1, 'rgba(255, 160, 96, 0)');
      ctx.fillStyle = g;
      ctx.fill();
    }

    // ---------- 太阳 ----------
    const bodyA = smooth(DAWN.RISE0, DAWN.RISE0 + 0.7, t);
    if (bodyA > 0.001) {
      radial(cx, sunY, R * 0.6, R * 2.5, [
        [0, `rgba(255, 196, 120, ${0.58 * bodyA})`],
        [1, 'rgba(255, 140, 80, 0)'],
      ]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = bodyA;
      const g = ctx.createRadialGradient(cx, sunY - R * 0.22, 0, cx, sunY, R);
      g.addColorStop(0, '#fffdf6');
      g.addColorStop(0.28, '#ffefc6');
      g.addColorStop(0.58, '#ffc77a');
      g.addColorStop(0.84, '#f39a5c');
      g.addColorStop(1, '#e07a52');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, sunY, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
    }

    // ---------- 海面（遮住地平线以下的太阳） ----------
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0a0807';
    ctx.fillRect(0, hy, W, H - hy);
    ctx.globalCompositeOperation = 'lighter';
    if (hz > 0) {
      const g = ctx.createLinearGradient(0, hy, 0, H);
      g.addColorStop(0, `rgba(72, 36, 24, ${0.5 * hz})`);
      g.addColorStop(1, 'rgba(20, 10, 8, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy, W, H - hy);
    }

    // ---------- 海面倒影 ----------
    if (sunK > 0.01) {
      const depth = H - hy;
      const step = Math.max(2, 3 * u);
      for (let y = hy + 1; y < H; y += step) {
        const d = (y - hy) / depth;
        const yy = y / u;
        const wave = 0.5 + 0.5 * Math.sin(yy * 0.19 + t * 2.4 + Math.sin(yy * 0.045 - t * 1.3) * 2.2);
        const a = sunK * 0.55 * (1 - d) ** 1.7 * (0.5 + 0.5 * Math.sin(yy * 0.83 + t * 6.1));
        if (a < 0.012) continue;
        const w = R * (0.45 + d * 1.9) * (0.35 + 0.65 * wave) * (0.4 + 0.6 * rise);
        const off = Math.sin(yy * 0.07 + t * 1.7) * R * 0.1 * d;
        ctx.fillStyle = `rgba(255, ${(168 + (1 - d) * 54) | 0}, ${(100 + (1 - d) * 70) | 0}, ${a.toFixed(3)})`;
        ctx.fillRect(cx - w / 2 + off, y, w, Math.max(1, step * 0.45));
      }
      ctx.save();
      ctx.translate(cx, hy);
      ctx.scale(1, 0.5);
      radial(0, 0, 0, R * 3.4, [
        [0, `rgba(255, 150, 82, ${0.2 * sunK})`],
        [1, 'rgba(255, 150, 82, 0)'],
      ]);
      ctx.restore();
    }

    // ---------- 地平线 + 横向光晕 ----------
    if (hz > 0) {
      const half = W * 0.5 * easeOutExpo(hz);
      const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, 'rgba(255, 190, 130, 0)');
      g.addColorStop(0.5, 'rgba(255, 230, 196, 0.95)');
      g.addColorStop(1, 'rgba(255, 190, 130, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - half, hy - 0.8 * u, half * 2, 1.6 * u);
    }
    const touch = t > DAWN.DROP1 - 0.08 ? Math.exp(-(((t - DAWN.DROP1) / 0.32) ** 2)) : 0;
    const crest = Math.exp(-((t - (DAWN.RISE0 + 0.6)) ** 2) / 0.22);
    const flareA = (hz > 0 ? 0.24 * sunK + 0.5 * crest : 0) + 0.9 * touch;
    if (flareA > 0.01) {
      ctx.save();
      ctx.translate(cx, hy);
      ctx.scale(1, 0.032);
      radial(0, 0, 0, W * 0.52, [
        [0, `rgba(255, 214, 162, ${Math.min(1, flareA)})`],
        [0.3, `rgba(255, 150, 92, ${Math.min(1, flareA) * 0.32})`],
        [1, 'rgba(255, 150, 92, 0)'],
      ]);
      ctx.restore();
      if (touch > 0.01) {
        radial(cx, hy, 0, R * 2.4, [
          [0, `rgba(255, 220, 170, ${0.7 * touch})`],
          [1, 'rgba(255, 160, 100, 0)'],
        ]);
      }
    }

    // ---------- 光尘汇聚 ----------
    if (t < DAWN.IGNITE + 0.05) {
      ctx.lineCap = 'round';
      const R0 = diag * 0.5;
      for (const p of gather) {
        if (t < p.start || t > p.arrive) continue;
        const k = clamp01((t - p.start) / (p.arrive - p.start));
        const k0 = Math.max(0, k - 0.045);
        const pos = (kk) => {
          const e = kk ** 2.3;
          const r = p.d * R0 * (1 - e);
          const ang = p.a + p.spin * e;
          return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
        };
        const [x1, y1] = pos(k);
        const [x0, y0] = pos(k0);
        const a = smooth(0, 0.18, k) * 0.85;
        ctx.strokeStyle = `rgba(${p.c}, ${a.toFixed(3)})`;
        ctx.lineWidth = p.size * u;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      const k = clamp01(t / DAWN.IGNITE);
      const flick = 0.9 + 0.1 * Math.sin(t * 38);
      radial(cx, cy, 0, lerp(30, 170, k * k) * u, [
        [0, `rgba(255, 210, 160, ${(0.08 + 0.62 * k ** 3) * flick})`],
        [0.35, `rgba(217, 119, 87, ${(0.04 + 0.26 * k ** 3) * flick})`],
        [1, 'rgba(217, 119, 87, 0)'],
      ]);
      radial(cx, cy, 0, (2 + 7 * k ** 3) * u, [
        [0, 'rgba(255, 248, 236, 0.95)'],
        [1, 'rgba(255, 220, 180, 0)'],
      ]);
    }

    // ---------- 点燃：闪光、冲击波、星火 ----------
    if (!ignited && t >= DAWN.IGNITE && !still) {
      ignited = true;
      burst(cx, cy, 200, 1);
    }
    const d = t - DAWN.IGNITE;
    if (d >= 0 && d < 0.85) {
      ctx.fillStyle = `rgba(255, 224, 188, ${(0.42 * (1 - d / 0.85) ** 3).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (d >= 0) {
      [[0, 0.65], [0.14, 0.38], [0.32, 0.22]].forEach(([delay, peak]) => {
        const p = (d - delay) / 1.6;
        if (p <= 0 || p >= 1) return;
        ctx.strokeStyle = `rgba(255, 186, 122, ${(peak * (1 - p) ** 2).toFixed(3)})`;
        ctx.lineWidth = (1 + 5 * (1 - p)) * u;
        ctx.beginPath();
        ctx.arc(cx, cy, easeOutCubic(p) * diag * 0.52, 0, TAU);
        ctx.stroke();
      });
    }
    if (d >= 0 && t < DAWN.DROP1 + 0.04) {
      let sy = cy;
      let sc = easeOutBack(clamp01(d / 0.45));
      const dropK = clamp01((t - DAWN.DROP0) / (DAWN.DROP1 - DAWN.DROP0));
      if (dropK > 0) {
        const e = easeInCubic(dropK);
        sy = lerp(cy, hy, e);
        sc *= lerp(1, 0.16, e);
        const g = ctx.createLinearGradient(0, cy, 0, sy);
        g.addColorStop(0, 'rgba(255, 190, 120, 0)');
        g.addColorStop(1, `rgba(255, 210, 160, ${0.55 * dropK})`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - 1.4 * u, cy, 2.8 * u, sy - cy);
      }
      const size = Math.min(W, H) * 0.072 * sc * (1 + 0.04 * Math.sin(d * 7));
      radial(cx, sy, 0, Math.max(1, size * 3.4), [
        [0, 'rgba(255, 178, 110, 0.6)'],
        [0.4, 'rgba(217, 119, 87, 0.2)'],
        [1, 'rgba(217, 119, 87, 0)'],
      ]);
      drawSpark(cx, sy, size, d * 0.55, 1);
    }

    // ---------- 迸发火星 ----------
    if (sparks.length) {
      ctx.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) {
          sparks.splice(i, 1);
          continue;
        }
        const damp = Math.exp(-s.drag * dt);
        s.vx *= damp;
        s.vy = s.vy * damp - 22 * u * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const a = (1 - s.age / s.life) ** 1.4;
        ctx.strokeStyle = `rgba(${s.c}, ${a.toFixed(3)})`;
        ctx.lineWidth = s.size;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 0.045, s.y - s.vy * 0.045);
        ctx.stroke();
      }
    }

    // ---------- 晨光中上升的余烬 ----------
    if (!still && t > DAWN.RISE0 + 0.4) {
      emberClock += dt * 16;
      while (emberClock > 1 && embers.length < 90) {
        emberClock -= 1;
        const gx = (rand() + rand() + rand() - 1.5) / 1.5;
        embers.push({
          x: cx + gx * W * 0.32,
          y: hy - rand() * H * 0.04,
          vy: -(16 + rand() * 52) * u,
          sway: (6 + rand() * 18) * u,
          ph: rand() * TAU,
          age: 0,
          life: 3 + rand() * 4.5,
          size: (0.7 + rand() * 1.7) * u,
          c: PALETTE[(rand() * PALETTE.length) | 0],
        });
      }
      if (emberClock > 1) emberClock = 1;
    }
    for (let i = embers.length - 1; i >= 0; i -= 1) {
      const e = embers[i];
      e.age += dt;
      if (e.age >= e.life) {
        embers.splice(i, 1);
        continue;
      }
      e.y += e.vy * dt;
      const x = e.x + Math.sin(e.ph + e.age * 1.4) * e.sway;
      const a = Math.sin(Math.PI * (e.age / e.life)) * 0.75 * sunK;
      ctx.fillStyle = `rgba(${e.c}, ${a.toFixed(3)})`;
      ctx.fillRect(x, e.y, e.size, e.size);
    }

    // ---------- 离场：暖光泛白 ----------
    if (t > exitAt) {
      const e = clamp01((t - exitAt) / DAWN.EXIT);
      radial(cx, sunY, 0, diag * 0.7, [
        [0, `rgba(255, 210, 160, ${(0.4 * e).toFixed(3)})`],
        [1, 'rgba(255, 170, 110, 0)'],
      ]);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    resize,
    draw,
    burst,
    exit(t) { exitAt = t; },
  };
}

/* ------------------------------------------------------------------
 * 音效时间轴
 * ------------------------------------------------------------------ */
function scheduleDawnSound(audio) {
  const { sfx, NOTE } = audio;
  const t0 = audio.now + 0.03;
  sfx.drone(t0, DAWN.END + 1.2);
  sfx.riser(t0 + 0.2, DAWN.IGNITE - 0.2);
  sfx.impact(t0 + DAWN.IGNITE);
  sfx.sparkle(t0 + DAWN.IGNITE + 0.03, 7, 0.07);
  sfx.whoosh(t0 + DAWN.DROP0, DAWN.DROP1 - DAWN.DROP0 + 0.05, 0.09);
  sfx.bell(t0 + DAWN.DROP1, NOTE.A4, 0.14, 3.2);
  sfx.pad(t0 + DAWN.RISE0, DAWN.END - DAWN.RISE0 + 1.4, 0.055);
  // 标题四字：五声音阶上行
  [NOTE.D5, NOTE.Fs5, NOTE.A5, NOTE.D6].forEach((f, i) => sfx.bell(t0 + 3.55 + i * 0.2, f, 0.15, 2.8));
  sfx.bell(t0 + 4.75, NOTE.B4, 0.07, 2.2); // 一体机启动器
  // 标语打字：每字一下极轻的拨音
  for (let i = 0; i < 10; i += 1) sfx.pluck(t0 + 5.55 + (i + 1) * 0.13, i % 2 ? NOTE.A6 : NOTE.Fs6, 0.022);
  // 功能标签依次点亮
  [NOTE.A5, NOTE.B5, NOTE.D6, NOTE.E6, NOTE.Fs6, NOTE.A6].forEach((f, i) => sfx.pluck(t0 + 6.6 + i * 0.15, f, 0.07));
  // 署名
  sfx.bell(t0 + 7.75, NOTE.D5, 0.08, 2.4);
  sfx.bell(t0 + 8.05, NOTE.A5, 0.08, 2.4);
  sfx.bell(t0 + DAWN.CLAUDE, NOTE.D6, 0.1, 3);
  sfx.sparkle(t0 + DAWN.CLAUDE + 0.02, 9, 0.06);
}

/* ------------------------------------------------------------------
 * 控制器
 * ------------------------------------------------------------------ */
function hydrate(root, version) {
  if (!root.dataset.hydrated) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const key = el.dataset.icon;
      el.innerHTML = APP_ICON[key] || ICON[key] || '';
    });
    const mark = root.querySelector('.dawn-claude-mark');
    if (mark) mark.innerHTML = claudeSparkSvg('dawn-claude-svg');
    root.dataset.hydrated = '1';
  }
  const v = root.querySelector('#dawn-version');
  if (v && version) v.textContent = `v${version}`;
}

/**
 * 播放「破晓」开场。返回 { finish } 以便外部提前结束。
 */
export function playDawnIntro({ reduceMotion = false, sound = true, version = '', onDone } = {}) {
  const root = $('#intro-dawn');
  if (!root) {
    if (onDone) onDone();
    return { finish() {} };
  }
  hydrate(root, version);

  root.hidden = false;
  root.style.display = '';
  root.removeAttribute('aria-hidden');
  root.classList.remove('is-playing', 'is-leaving', 'is-static');
  void root.offsetWidth; // 重新触发 CSS 动画（设置里预览时需要）

  const canvas = root.querySelector('.dawn-canvas');
  const scene = canvas ? createScene(canvas, { still: reduceMotion }) : null;
  if (scene) scene.resize();

  let audio = null;
  if (sound) {
    audio = createIntroAudio({ volume: 0.62 });
    if (audio) {
      audio.resume();
      try { scheduleDawnSound(audio); } catch (_) { audio = null; }
    }
  }

  const startedAt = performance.now();
  const elapsed = () => (performance.now() - startedAt) / 1000;
  let raf = null;
  let finished = false;
  const timers = [];
  const cleanups = [];

  root.classList.add(reduceMotion ? 'is-static' : 'is-playing');

  if (scene) {
    if (reduceMotion) {
      scene.draw(9.5);
      const onResize = () => { scene.resize(); scene.draw(9.5); };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));
    } else {
      const loop = () => {
        scene.draw(elapsed());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      const onResize = () => scene.resize();
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      // Claude 星火在署名处闪耀时，画布同步迸发一圈火星
      timers.push(setTimeout(() => {
        const mark = root.querySelector('.dawn-claude-mark');
        if (!mark) return;
        const r = mark.getBoundingClientRect();
        scene.burst(r.left + r.width / 2, r.top + r.height / 2, 70, 0.42);
      }, DAWN.CLAUDE * 1000));
    }
  }

  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    cleanups.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
    if (scene) scene.exit(elapsed());
    if (audio) {
      try { audio.sfx.whoosh(audio.now, 0.8, 0.12); } catch (_) { /* ignore */ }
      audio.stop(1.1);
    }
    root.classList.add('is-leaving');
    root.setAttribute('aria-hidden', 'true');
    const delay = reduceMotion ? 260 : DAWN.EXIT * 1000;
    setTimeout(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      root.hidden = true;
      root.style.display = 'none';
      root.classList.remove('is-playing', 'is-leaving', 'is-static');
      if (onDone) onDone();
    }, delay);
  };

  const onPointer = () => {
    if (elapsed() < 0.6) return;
    finish();
  };
  const onKey = (event) => {
    if (['Enter', ' ', 'Escape'].includes(event.key)) finish();
  };
  root.addEventListener('pointerdown', onPointer);
  window.addEventListener('keydown', onKey);
  cleanups.push(() => root.removeEventListener('pointerdown', onPointer));
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  timers.push(setTimeout(finish, (reduceMotion ? 3.4 : DAWN.END) * 1000));
  return { finish };
}
