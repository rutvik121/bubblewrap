// Bubble-wrap pops & soundscapes, synthesised with Web Audio API.
// Features:
// 1. Classic plastic pop (snap click + resonating cavity + falling thump + plastic settling ticks)
// 2. Sound packs: Classic, Water Plop, Mechanical Switch (Thock), Wooden Marimba
// 3. Lucky Golden Bubble chime resonance
// 4. Procedural ASMR ambient soundscapes: Rain, Ocean Waves, Zen Hum

const VOICES = [
  { w: 3.0, snap: 1300, q: 1.1, dec: 0.032, gain: 0.8, ring: 840, thump: 235, tDec: 0.05, tGain: 0.5 }, // soft
  { w: 3.0, snap: 2500, q: 1.6, dec: 0.016, gain: 1.0, ring: 1500, thump: 350, tDec: 0.03, tGain: 0.32 }, // sharp
  { w: 2.0, snap: 3300, q: 2.2, dec: 0.01, gain: 0.5, ring: 2150, thump: 0, tDec: 0, tGain: 0 }, // tiny
  { w: 1.3, snap: 780, q: 0.9, dec: 0.052, gain: 1.0, ring: 520, thump: 150, tDec: 0.1, tGain: 0.8 }, // deep
];
const DEEP = VOICES[3];

const MIXES = {
  mixed: [3, 3, 2, 1.3],
  soft: [5, 0.4, 0.8, 1.6],
  crisp: [0.5, 5, 2.5, 0],
  deep: [1.6, 0.2, 0, 5],
};

const MARIMBA_NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

const rand = (a, b) => a + Math.random() * (b - a);

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
let iosAudioUnlocked = false;

export function configureAudioSession() {
  if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
    try {
      navigator.audioSession.type = 'playback';
    } catch {}
  }
}

export function unlockIOSAudio() {
  if (iosAudioUnlocked) return;
  iosAudioUnlocked = true;
  configureAudioSession();
  try {
    const audio = new Audio();
    audio.src = SILENT_WAV;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        audio.pause();
        audio.remove();
      }).catch(() => {});
    }
  } catch {}
}

export class PopAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.calm = 0;
    this.volume = 0.9;
    this.soundPack = 'classic'; // classic | plop | thock | marimba
    this.mix = MIXES.mixed;
    this.ambientType = 'off'; // off | rain | waves | hum
    this.ambientVol = 0.35;
    this._unlocked = false;
    this.ambientNodes = null;
    this.ambientInterval = null;
    this.noteIdx = 0;
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return false;
    let ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        return false;
      }
    }
    const sampleRate = ctx.sampleRate || 44100;
    const len = Math.floor(sampleRate * 2.5);
    const buf = ctx.createBuffer(1, len, sampleRate);
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

    this.ambientMaster = ctx.createGain();
    this.ambientMaster.gain.setValueAtTime(0, ctx.currentTime);
    this.ambientMaster.connect(ctx.destination);

    this.ctx = ctx;
    this.noise = buf;
    this._level(0);
    this._updateAmbient();
    return true;
  }

  _unlockBuffer() {
    if (!this.ctx || this._unlocked) return;
    try {
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
      this._unlocked = true;
    } catch {}
  }

  resume() {
    configureAudioSession();
    unlockIOSAudio();
    if (this._ensure()) {
      this._unlockBuffer();
      if (this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
      this._updateAmbient();
    }
  }

  _level(glide) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * (1 - 0.45 * this.calm), t, glide);
    this.tone.frequency.setTargetAtTime(16000 - 9500 * this.calm, t, glide);
    if (this.ambientMaster) {
      const targetAmbient = this.muted || this.ambientType === 'off' ? 0 : this.ambientVol * this.volume;
      this.ambientMaster.gain.setTargetAtTime(targetAmbient, t, glide);
    }
  }

  setMuted(m) {
    this.muted = m;
    this._level(0.015);
  }

  setVolume(v) {
    this.volume = v;
    this._level(0.02);
  }

  setSoundPack(name) {
    this.soundPack = name || 'classic';
  }

  setVoice(name) {
    this.mix = MIXES[name] || MIXES.mixed;
  }

  setCalm(c) {
    this.calm = c;
    this._level(0.6);
  }

  setAmbient(type) {
    if (this.ambientType === type) return;
    this.ambientType = type;
    if (this.ctx) {
      this._updateAmbient();
    }
  }

  setAmbientVolume(v) {
    this.ambientVol = v;
    this._level(0.05);
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
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.02);
  }

  // ---------------------------------------------------------------- Ambient ASMR
  _stopAmbientNodes() {
    if (this.ambientInterval) {
      clearInterval(this.ambientInterval);
      this.ambientInterval = null;
    }
    if (this.ambientNodes) {
      try {
        this.ambientNodes.forEach((node) => {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        });
      } catch {}
      this.ambientNodes = null;
    }
  }

  _updateAmbient() {
    if (!this.ctx) return;
    this._stopAmbientNodes();
    const targetAmbient = this.muted || this.ambientType === 'off' ? 0 : this.ambientVol * this.volume;
    this.ambientMaster.gain.setTargetAtTime(targetAmbient, this.ctx.currentTime, 0.3);

    if (this.ambientType === 'off' || this.muted) return;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const nodes = [];

    if (this.ambientType === 'rain') {
      // Pinkish noise background for rain bed
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1400, t);
      bp.Q.setValueAtTime(0.65, t);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4500, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, t);
      src.connect(bp).connect(lp).connect(g).connect(this.ambientMaster);
      src.start(t);
      nodes.push(src, bp, lp, g);

      // Random droplet spatters
      this.ambientInterval = setInterval(() => {
        if (!this.ctx || this.muted || this.ambientType !== 'rain') return;
        const now = this.ctx.currentTime;
        const dropOut = ctx.createGain();
        dropOut.gain.setValueAtTime(rand(0.08, 0.22), now);
        dropOut.connect(this.ambientMaster);
        this._burst(now, dropOut, 'bandpass', rand(3000, 6500), rand(5, 9), 0.3, rand(0.015, 0.035));
      }, 140);
    } else if (this.ambientType === 'waves') {
      // Ocean surf: noise with LFO modulating a sweeping lowpass filter
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(450, t);
      f.Q.setValueAtTime(1.8, t);

      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.18, t); // ~5.5s surge
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(320, t);
      lfo.connect(lfoGain).connect(f.frequency);
      lfo.start(t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      src.connect(f).connect(g).connect(this.ambientMaster);
      src.start(t);
      nodes.push(src, f, lfo, lfoGain, g);
    } else if (this.ambientType === 'hum') {
      // Soothing warm meditative dual sines
      const osc1 = ctx.createOscillator();
      osc1.frequency.setValueAtTime(108, t);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.18, t);
      osc1.connect(g1).connect(this.ambientMaster);
      osc1.start(t);

      const osc2 = ctx.createOscillator();
      osc2.frequency.setValueAtTime(162.4, t);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.12, t);
      osc2.connect(g2).connect(this.ambientMaster);
      osc2.start(t);

      nodes.push(osc1, osc2, g1, g2);
    }

    this.ambientNodes = nodes;
  }

  // ---------------------------------------------------------------- Pops
  pop({ strong = false, pan = 0, size = 1, special = false } = {}) {
    if (this.muted) return;
    if (!this._ensure()) return;
    if (this.ctx.state !== 'running') {
      this.resume();
    }
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    const loud = (strong ? 1.35 : 1) * rand(0.85, 1.05);
    out.gain.value = loud;

    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.55;
      out.connect(p).connect(this.master);
    } else {
      out.connect(this.master);
    }

    // Play according to selected sound pack
    if (this.soundPack === 'plop') {
      this._popPlop(t, out, size, strong);
    } else if (this.soundPack === 'thock') {
      this._popThock(t, out, size, strong);
    } else if (this.soundPack === 'marimba') {
      this._popMarimba(t, out, size, strong);
    } else {
      this._popClassic(t, out, size, strong);
    }

    // Lucky Golden Bubble chime resonance
    if (special) {
      this._chime(t, out);
    }
  }

  _popClassic(t, out, size, strong) {
    const ctx = this.ctx;
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
    const tune = Math.pow(1 / size, 1.6) * rand(0.9, 1.12);

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

    const ticks = strong ? 3 : Math.random() < 0.6 ? 2 : 1;
    for (let k = 0; k < ticks; k++) {
      this._burst(t + rand(0.018, 0.085), out, 'highpass', rand(4500, 7000), 0.7, rand(0.04, 0.1), 0.006);
    }
  }

  _popPlop(t, out, size, strong) {
    // Water drop / bubble plop: frequency-swept sine + gentle bubble splash
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const baseFreq = (620 / Math.pow(size, 0.8)) * rand(0.92, 1.08);
    const endFreq = baseFreq * rand(1.8, 2.3);
    const dur = (strong ? 0.09 : 0.065);

    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.01);

    // Light aquatic water droplet click
    this._burst(t, out, 'bandpass', endFreq * 1.5, 4.5, 0.35, 0.018);
  }

  _popThock(t, out, size, strong) {
    // Mechanical keyboard switch: sharp click + damped low-mid body thud
    const ctx = this.ctx;
    const tune = 1 / Math.pow(size, 0.6);
    const thumpFreq = (strong ? 190 : 230) * tune * rand(0.95, 1.05);

    // Initial click transient
    this._burst(t, out, 'highpass', 3800 * tune, 1.2, 0.75, 0.008);

    // Resonant mechanical body
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(thumpFreq, t);
    osc.frequency.exponentialRampToValueAtTime(thumpFreq * 0.6, t + 0.04);

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  _popMarimba(t, out, size, strong) {
    // Struck wooden bar: pentatonic acoustic fundamental + subtle soft overtone
    const ctx = this.ctx;
    const note = MARIMBA_NOTES[this.noteIdx % MARIMBA_NOTES.length];
    this.noteIdx = (this.noteIdx + (Math.random() < 0.4 ? 2 : 1)) % MARIMBA_NOTES.length;
    const dur = strong ? 0.22 : 0.16;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note, t);

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);

    // Wooden bar mallet strike transient
    this._burst(t, out, 'bandpass', note * 2.8, 3.5, 0.45, 0.015);
  }

  _chime(t, out) {
    // Celestial shimmer harmonic chime for lucky golden bubbles
    const ctx = this.ctx;
    const freqs = [1046.5, 1567.98, 2093.0]; // C6, G6, C7
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + idx * 0.02);
      g.gain.setValueAtTime(0.0001, t + idx * 0.02);
      g.gain.linearRampToValueAtTime(0.35 / (idx + 1), t + idx * 0.02 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.02 + 0.55);
      osc.connect(g).connect(out);
      osc.start(t + idx * 0.02);
      osc.stop(t + idx * 0.02 + 0.6);
    });
  }

  dud({ pan = 0 } = {}) {
    if (this.muted) return;
    if (!this._ensure()) return;
    if (this.ctx.state !== 'running') {
      this.resume();
    }
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    this._burst(t, out, 'highpass', rand(3800, 5200), 0.7, 0.07, 0.012);
    this._burst(t + rand(0.02, 0.04), out, 'highpass', rand(5000, 7000), 0.7, 0.045, 0.008);
  }

  rustle() {
    if (this.muted) return;
    if (!this._ensure()) return;
    if (this.ctx.state !== 'running') {
      this.resume();
    }
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
    this._stopAmbientNodes();
    this.ctx?.close();
    this.ctx = null;
  }
}
