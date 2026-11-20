/**
 * 开场动画音效引擎（v2.0 新增）。
 *
 * 全部声音由 Web Audio 实时合成，不依赖任何音频文件：
 *   - 低频暖底（drone）与渐强和弦（pad）营造「破晓」的空间感；
 *   - 噪声上扬（riser）+ 低频冲击（impact）对应星火点燃；
 *   - 钟琴音（bell）对应标题逐字出现，五声音阶，听感明亮不刺耳；
 *   - 轻拨音（pluck）对应功能标签依次点亮；
 *   - 高频闪烁（sparkle）对应 Claude 星火标志；
 *   - 收尾气流（whoosh）对应转场离场。
 *
 * 所有音效都挂在同一个 master 总线上，经过合成混响与压缩器，
 * 任何时候调用 stop() 都会在 0.6 秒内柔和淡出并释放 AudioContext。
 */

const NOTE = {
  D2: 73.42, A2: 110.0, D3: 146.83, A3: 220.0, E4: 329.63, Fs4: 369.99, A4: 440.0,
  B4: 493.88, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880.0, B5: 987.77,
  D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760.0,
};

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      const k = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
    }
  }
  return buffer;
}

function makeNoise(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createIntroAudio({ volume = 0.6 } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ctx;
  try {
    ctx = new AC({ latencyHint: 'playback' });
  } catch (_) {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 18;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.006;
  comp.release.value = 0.3;
  master.connect(comp);
  comp.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 3.6, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  reverb.connect(wet);
  wet.connect(master);

  const noiseBuffer = makeNoise(ctx, 3);
  let stopped = false;
  const live = new Set();

  const track = (node, until) => {
    live.add(node);
    try { node.stop(until); } catch (_) { /* ignore */ }
    node.onended = () => live.delete(node);
  };

  // 发送到干声 + 混响
  const bus = (send = 0.5) => {
    const g = ctx.createGain();
    g.connect(master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(reverb);
    }
    return g;
  };

  const env = (param, t, peak, attack, hold, release, floor = 0.0001) => {
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(floor, t + attack + hold + release);
  };

  const sfx = {
    /** 低频暖底：D2 + A2，缓慢起伏 */
    drone(t, dur) {
      const out = bus(0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(180, t);
      lp.frequency.linearRampToValueAtTime(520, t + dur * 0.7);
      lp.Q.value = 0.6;
      lp.connect(out);
      env(out.gain, t, 0.16, dur * 0.35, dur * 0.35, dur * 0.3);
      [[NOTE.D2, 'sine', 1], [NOTE.A2, 'triangle', 0.5], [NOTE.D2 * 1.004, 'sawtooth', 0.12]].forEach(([f, type, g]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const gg = ctx.createGain();
        gg.gain.value = g;
        o.connect(gg);
        gg.connect(lp);
        o.start(t);
        track(o, t + dur + 0.1);
      });
    },

    /** 噪声上扬：带通扫频，收束到点燃瞬间 */
    riser(t, dur) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
      const out = bus(0.6);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.92);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
      src.connect(bp);
      bp.connect(out);
      src.start(t);
      track(src, t + dur + 0.1);
    },

    /** 点燃冲击：低频下潜 + 噪声爆破 */
    impact(t) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
      const g = bus(0.35);
      env(g.gain, t, 0.75, 0.008, 0.05, 1.2);
      o.connect(g);
      o.start(t);
      track(o, t + 1.4);

      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.0);
      const ng = bus(0.8);
      env(ng.gain, t, 0.32, 0.004, 0.02, 1.0);
      n.connect(lp);
      lp.connect(ng);
      n.start(t);
      track(n, t + 1.2);
    },

    /** 钟琴音：基频 + 非整数倍泛音，带长混响尾 */
    bell(t, freq, gain = 0.2, decay = 2.6) {
      const out = bus(0.7);
      env(out.gain, t, gain, 0.004, 0, decay);
      [[1, 1], [2.0, 0.32], [2.76, 0.16], [5.4, 0.06]].forEach(([ratio, g]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq * ratio;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(g, t);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + decay / (ratio > 1 ? ratio * 0.7 : 1));
        o.connect(gg);
        gg.connect(out);
        o.start(t);
        track(o, t + decay + 0.1);
      });
    },

    /** 轻拨音：三角波 + 快速衰减 */
    pluck(t, freq, gain = 0.1) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(freq * 6, t);
      lp.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.35);
      const out = bus(0.55);
      env(out.gain, t, gain, 0.003, 0, 0.55);
      o.connect(lp);
      lp.connect(out);
      o.start(t);
      track(o, t + 0.7);
    },

    /** 渐强和弦：D add9，失谐锯齿波 + 低通扫开 */
    pad(t, dur, gain = 0.06) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.45);
      lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      const out = bus(0.75);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
      out.gain.setValueAtTime(gain, t + dur * 0.62);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      lp.connect(out);
      [NOTE.D3, NOTE.A3, NOTE.E4, NOTE.Fs4, NOTE.A4].forEach((f) => {
        [-7, 7].forEach((cents) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(t);
          track(o, t + dur + 0.1);
        });
      });
    },

    /** 高频闪烁：一串随机的极短钟音 */
    sparkle(t, count = 7, gain = 0.06) {
      const notes = [NOTE.D6, NOTE.E6, NOTE.Fs6, NOTE.A6, NOTE.A5, NOTE.B5];
      for (let i = 0; i < count; i += 1) {
        const at = t + i * 0.055 + Math.random() * 0.03;
        sfx.bell(at, notes[(i * 3 + Math.floor(Math.random() * 2)) % notes.length], gain * (1 - i / (count * 1.4)), 0.9);
      }
    },

    /** 气流：高通扫频的噪声，转场用 */
    whoosh(t, dur = 0.9, gain = 0.18) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.Q.value = 0.9;
      hp.frequency.setValueAtTime(500, t);
      hp.frequency.exponentialRampToValueAtTime(6000, t + dur);
      const out = bus(0.6);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(gain, t + dur * 0.6);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(hp);
      hp.connect(out);
      src.start(t);
      track(src, t + dur + 0.05);
    },
  };

  return {
    NOTE,
    sfx,
    get now() { return ctx.currentTime; },
    resume() {
      if (ctx.state === 'suspended') return ctx.resume().catch(() => {});
      return Promise.resolve();
    },
    /** 柔和淡出并释放 */
    stop(fade = 0.6) {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + fade);
      } catch (_) { /* ignore */ }
      setTimeout(() => {
        live.forEach((node) => { try { node.stop(); } catch (_) { /* ignore */ } });
        live.clear();
        ctx.close().catch(() => {});
      }, (fade + 0.3) * 1000);
    },
  };
}
