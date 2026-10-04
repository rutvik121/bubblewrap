// Bubble-wrap pops, synthesised. A pop is three things at once: the film
// snapping (a filtered noise click), the air cavity ringing for an instant
// (a narrow resonance and a falling thump), and a few ticks of plastic
// settling afterwards. Four voices, each randomised a little on every pop.

const VOICES = [
  { w: 3.0, snap: 1300, q: 1.1, dec: 0.032, gain: 0.8, ring: 840, thump: 235, tDec: 0.05, tGain: 0.5 }, // soft
  { w: 3.0, snap: 2500, q: 1.6, dec: 0.016, gain: 1.0, ring: 1500, thump: 350, tDec: 0.03, tGain: 0.32 }, // sharp
  { w: 2.0, snap: 3300, q: 2.2, dec: 0.01, gain: 0.5, ring: 2150, thump: 0, tDec: 0, tGain: 0 }, // tiny
  { w: 1.3, snap: 780, q: 0.9, dec: 0.052, gain: 1.0, ring: 520, thump: 150, tDec: 0.1, tGain: 0.8 }, // deep
];
const DEEP = VOICES[3];
// How often each voice turns up, per sound character (soft, sharp, tiny, deep).
const MIXES = {
  mixed: [3, 3, 2, 1.3],
  soft: [5, 0.4, 0.8, 1.6],
  crisp: [0.5, 5, 2.5, 0],
  deep: [1.6, 0.2, 0, 5],
};

const rand = (a, b) => a + Math.random() * (b - a);

export class PopAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.calm = 0;
    this.volume = 0.9;
    this.mix = MIXES.mixed;
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC({ latencyHint: 'interactive' });
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.master = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.4;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.09;
    this.master.connect(this.tone).connect(comp).connect(ctx.destination);

    this.ctx = ctx;
    this.noise = buf;
    this._level(0);
    return true;
  }

  /** Must be called from inside a user gesture; browsers keep audio locked until then. */
  resume() {
    if (this._ensure() && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _level(glide) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * (1 - 0.45 * this.calm), t, glide);
    this.tone.frequency.setTargetAtTime(16000 - 9500 * this.calm, t, glide);
  }

  setMuted(m) {
    this.muted = m;
    this._level(0.015);
  }

  setVolume(v) {
    this.volume = v;
    this._level(0.02);
  }

  /** mixed | soft | crisp | deep */
  setVoice(name) {
    this.mix = MIXES[name] || MIXES.mixed;
  }

  /** 0 = start of a sheet, 1 = calm. Everything gets a little quieter and rounder. */
  setCalm(c) {
    this.calm = c;
    this._level(0.6);
  }

  _burst(t, out, type, freq, q, gain, decay) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.2);
    src.stop(t + decay + 0.02);
  }

  pop({ strong = false, pan = 0, size = 1 } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    let v = DEEP;
    if (!strong) {
      const total = this.mix[0] + this.mix[1] + this.mix[2] + this.mix[3];
      let pick = Math.random() * total;
      for (let k = 0; k < 4; k++) {
        if (this.mix[k] <= 0) continue;
        v = VOICES[k];
        if ((pick -= this.mix[k]) <= 0) break;
      }
    }
    // Bigger bubbles sit lower.
    const tune = Math.pow(1 / size, 1.6) * rand(0.9, 1.12);
    const loud = (strong ? 1.35 : 1) * rand(0.82, 1.05);

    const out = ctx.createGain();
    out.gain.value = loud;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.55;
      out.connect(p).connect(this.master);
    } else {
      out.connect(this.master);
    }

    this._burst(t, out, 'bandpass', v.snap * tune, v.q, v.gain, v.dec * rand(0.85, 1.2));
    this._burst(t, out, 'bandpass', v.ring * tune, 9, v.gain * 1.5, v.dec * 1.9);

    if (v.thump) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(v.thump * tune, t);
      o.frequency.exponentialRampToValueAtTime(v.thump * tune * 0.4, t + v.tDec);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v.tGain, t + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + v.tDec);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + v.tDec + 0.02);
    }

    // Slack film settling.
    const ticks = strong ? 3 : Math.random() < 0.6 ? 2 : 1;
    for (let k = 0; k < ticks; k++) {
      this._burst(t + rand(0.018, 0.085), out, 'highpass', rand(4500, 7000), 0.7, rand(0.04, 0.1), 0.006);
    }
  }

  /** Pressing a bubble that's already gone: just a faint crinkle. */
  dud({ pan = 0 } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    this._burst(t, out, 'highpass', rand(3800, 5200), 0.7, 0.07, 0.012);
    this._burst(t + rand(0.02, 0.04), out, 'highpass', rand(5000, 7000), 0.7, 0.045, 0.008);
  }

  /** Plastic sliding over the table as fresh wrap comes off the roll. */
  rustle() {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.linearRampToValueAtTime(3200, t + 0.5);
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + 1.05);

    for (let k = 0; k < 9; k++) {
      this._burst(t + rand(0.05, 0.75), out, 'highpass', rand(3500, 6500), 0.7, rand(0.02, 0.06), 0.007);
    }
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
