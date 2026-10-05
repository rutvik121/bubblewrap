import * as THREE from 'three';
import {
  SHEET_VERT,
  SHEET_FRAG,
  BUBBLE_VERT,
  BUBBLE_FRAG,
  SPECK_VERT,
  SPECK_FRAG,
} from './shaders.js';
import { THEMES } from '../settings.js';

const FOV = 24;
const MAX_DPR = 2;
const SPECKS = 160;
const ROW = 0.8660254;
const SIZE = { s: 0.72, m: 1, l: 1.4 };
const FEEL = { light: 0.45, normal: 1, firm: 1.9 };
// One screenful of wrap counts as half a metre, whatever the screen or bubble size.
const SHEET_MM = 500;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

// Stable 0..1 hash so a bubble keeps its character across rebuilds.
function hash(a, b, s) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Light at the start of a session (cool, contrasty) and once it has wound down (warm, soft).
const LIGHT = {
  key: [new THREE.Color(1.0, 0.985, 0.96), new THREE.Color(1.0, 0.93, 0.84)],
  amb: [new THREE.Color(0.2, 0.225, 0.26), new THREE.Color(0.27, 0.25, 0.23)],
  keyPow: [9, 6.5],
};
// Shader colours are written straight to the screen, so keep them in display space.
const display = (hex) => new THREE.Color(hex).convertLinearToSRGB();
const WARM = display('#8f7f70');

// One disc, dense where the wall curves, reused for every bubble. The outer
// ring only carries the shadow.
function discGeometry() {
  const rings = [0.2, 0.36, 0.5, 0.61, 0.7, 0.78, 0.85, 0.905, 0.95, 0.98, 1.0, 1.05, 1.11, 1.46];
  const seg = 36;
  const pos = [0, 0, 0];
  const idx = [];
  for (const r of rings) {
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let k = 0; k < rings.length - 1; k++) {
    const a = 1 + k * seg;
    const b = a + seg;
    for (let s = 0; s < seg; s++) {
      const n = (s + 1) % seg;
      idx.push(a + s, b + s, b + n, a + s, b + n, a + n);
    }
  }
  return { position: new Float32Array(pos), index: idx };
}

export class BubbleWrap {
  /**
   * options:  { theme, size, endless, feel } (see settings.js)
   * handlers: onPress(), onPop({ strong, pan, size, calm, length }), onDud({ pan }), onFeed({ length })
   */
  constructor(canvas, options = {}, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.opt = { theme: 'studio', size: 'm', endless: 'roll', feel: 'normal', ...options };
    this.interactive = true;
    this.pointers = new Map();
    this.pending = [];
    this.time = 0;
    this.last = 0;
    this.awake = true;
    this.quiet = 0;
    this.calm = 0;
    this.calmTarget = 0;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.lastPopT = -10;
    this.feedCheck = 0;
    this.perPop = 1;
    this.accrued = 0;
    this.sheetSeed = (Math.random() * 1e6) | 0;
    this.rippleSlot = 0;
    this.ptr = { x: 0, y: 0, s: 0 };
    this.bg = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x15181d, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);

    const keyDir = new THREE.Vector3(-0.42, 0.52, 0.74).normalize();
    const keyX = new THREE.Vector3(0, 0, 1).cross(keyDir).normalize();
    const keyY = keyDir.clone().cross(keyX);
    this.uniforms = {
      uTime: { value: 0 },
      uPitch: { value: 80 },
      uScroll: { value: 0 },
      uWrinkle: { value: 9 },
      uRipples: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -10, 0)) },
      uPointer: { value: new THREE.Vector3() },
      uKeyDir: { value: keyDir },
      uKeyX: { value: keyX },
      uKeyY: { value: keyY },
      uKeyCol: { value: new THREE.Color() },
      uKeyPow: { value: 9 },
      uFillDir: { value: new THREE.Vector3(0.62, -0.42, 0.66).normalize() },
      uFillCol: { value: new THREE.Color(1.5, 1.6, 1.8) },
      uAmb: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uBgA: { value: new THREE.Color() },
      uBgB: { value: new THREE.Color() },
      uTex: { value: 0.03 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTintAmt: { value: 0 },
      uStrip: { value: new THREE.Vector2() },
      uView: { value: new THREE.Vector3() },
      uFilm: { value: new THREE.Color(0.9, 0.93, 0.96) },
      uDpr: { value: 1 },
    };

    const mat = (vertexShader, fragmentShader, blend) =>
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: blend,
        premultipliedAlpha: blend,
        depthTest: false,
        depthWrite: false,
      });
    this.sheetMat = mat(SHEET_VERT, SHEET_FRAG, false);
    this.bubbleMat = mat(BUBBLE_VERT, BUBBLE_FRAG, true);
    this.speckMat = mat(SPECK_VERT, SPECK_FRAG, true);

    this.disc = discGeometry();
    this._initSpecks();
    this._setTheme();
    this._bind();
    this.resize();
    this._raf = requestAnimationFrame(this._tick);
  }

  // ---------------------------------------------------------------- layout

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.w = w;
    this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.uniforms.uDpr.value = dpr;

    // One world unit is one CSS pixel on the sheet; origin is the top-left corner.
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.aspect = w / h;
    this.camera.position.set(w / 2, -h / 2, dist);
    this.camera.lookAt(w / 2, -h / 2, 0);
    this.camera.updateProjectionMatrix();
    this.uniforms.uView.value.set(w / 2, -h / 2, Math.hypot(w, h) / 2);

    // The wrap is a strip running top to bottom: nearly full width on a phone,
    // a centred band with table either side on a wide screen.
    const side = w < 600 ? 12 : 40;
    const sw = Math.min(w - side * 2, clamp(h * 0.95, 520, 880));
    this.strip = { x0: (w - sw) / 2, x1: (w + sw) / 2, w: sw };
    this.uniforms.uStrip.value.set(this.strip.x0, this.strip.x1);

    // It's cut longer than the window, so mobile browser chrome sliding in and
    // out never forces a new one. Rebuild only when the width or the cover changes.
    if (!this.b || w !== this.builtW || h > this.coverH) this._build(true);
    else this._measure();
    this.wake();
  }

  _build(keep) {
    const prev = keep && this.b ? this.b : null;
    const { w, h } = this;
    // Fit a whole number of bubbles across the strip, with a sealed margin.
    const target = clamp(w / 6.5, 58, 88) * SIZE[this.opt.size];
    const cols = Math.max(3, Math.round(this.strip.w / target - 0.81));
    const pitch = this.strip.w / (cols + 0.81);
    const rowH = pitch * ROW;
    this.builtW = w;
    this.pitch = pitch;
    this.rowH = rowH;
    this.coverW = w + pitch * 2;
    this.coverH = h + 180;
    // Even, so a row recycled from top to bottom keeps its hex stagger.
    let rows = Math.ceil(this.coverH / rowH) + 3;
    rows += rows & 1;
    this.rows = rows;
    const n = cols * rows;
    const f = () => new Float32Array(n);

    this.b = {
      n,
      pitch,
      keys: new Map(),
      col: new Int32Array(n),
      row: new Int32Array(n),
      base: new Float32Array(n * 4),
      seeds: new Float32Array(n * 4),
      x: f(), y: f(), r: f(), size: f(), delay: f(),
      strong: new Uint8Array(n),
      special: new Uint8Array(n),
      popped: new Uint8Array(n),
      armed: new Uint8Array(n),
      armAt: f(), popAt: f(), regrowAt: f(),
      press: f(), pop: f(), age: f().fill(1),
      wob: f(), wobV: f(),
      ox: f(), oy: f(), ovx: f(), ovy: f(),
      cx: f(), cy: f(), tcx: f(), tcy: f(),
      tgt: f(),
    };
    const b = this.b;

    // Start one row above whatever part of the roll is currently in view.
    const row0 = Math.floor(this.scroll / rowH) - 2;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        this._place(i, c, row0 + r);
        if (prev && prev.pitch === pitch) {
          const j = prev.keys.get(c + ',' + (row0 + r));
          if (j !== undefined && prev.popped[j]) {
            b.popped[i] = 1;
            b.pop[i] = 1;
            b.regrowAt[i] = prev.regrowAt[j];
          }
        }
      }
    }

    if (this.bubbles) {
      this.scene.remove(this.bubbles, this.sheet);
      this.bubbles.geometry.dispose();
      this.sheet.geometry.dispose();
    }

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.disc.position, 3));
    g.setIndex(this.disc.index);
    this.baseAttr = new THREE.InstancedBufferAttribute(b.base, 4);
    this.seedAttr = new THREE.InstancedBufferAttribute(b.seeds, 4);
    this.dynA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.dynB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.dynA.setUsage(THREE.DynamicDrawUsage);
    this.dynB.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBase', this.baseAttr);
    g.setAttribute('aSeed', this.seedAttr);
    g.setAttribute('aDynA', this.dynA);
    g.setAttribute('aDynB', this.dynB);
    g.instanceCount = n;
    this.bubbles = new THREE.Mesh(g, this.bubbleMat);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 1;

    const sw = this.coverW + pitch * 2;
    const sh = this.coverH + pitch * 2;
    const cell = Math.max(pitch * 0.6, 40);
    const sg = new THREE.PlaneGeometry(sw, sh, Math.ceil(sw / cell), Math.ceil(sh / cell));
    sg.translate(sw / 2 - pitch * 2, -(sh / 2 - pitch * 2), 0);
    this.sheet = new THREE.Mesh(sg, this.sheetMat);
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 0;

    this.scene.add(this.sheet, this.bubbles);
    this.uniforms.uPitch.value = pitch;
    this.pending.length = 0;
    for (const p of this.pointers.values()) p.bubble = -1;
    this._measure();
  }

  // Each bubble is worth its share of the screenful it belongs to.
  _measure() {
    const b = this.b;
    let seen = 0;
    for (let i = 0; i < b.n; i++) {
      const y = b.y[i] + this.scroll;
      if (y <= 0 && y >= -this.h) seen++;
    }
    this.perPop = SHEET_MM / Math.max(1, seen);
  }

  /** Put instance i at a spot on the roll, fresh and full of air. */
  _place(i, col, row) {
    const b = this.b;
    const pitch = b.pitch;
    const seed = this.sheetSeed;
    const h1 = hash(col, row, seed);
    const h2 = hash(col, row, seed + 1);
    const h3 = hash(col, row, seed + 2);
    const h4 = hash(col, row, seed + 3);
    const size = 0.955 + 0.075 * h1;
    b.col[i] = col;
    b.row[i] = row;
    b.keys.set(col + ',' + row, i);
    b.x[i] = this.strip.x0 + (col + (row & 1 ? 0.5 : 0) + 0.655) * pitch + (h2 - 0.5) * pitch * 0.03;
    b.y[i] = -(row * this.rowH + this.rowH * 0.25) + (h3 - 0.5) * pitch * 0.03;
    b.r[i] = pitch * 0.435 * size;
    b.size[i] = size;
    // Most give way quickly, a few hold out a beat longer.
    b.delay[i] = 0.045 + 0.05 * h4 + (h2 > 0.9 ? 0.06 : 0);
    b.strong[i] = h3 > 0.92 ? 1 : 0;
    // A handful left the factory a little under-inflated.
    const limp = h1 > 0.975 ? 0.7 : 1;
    const o = i * 4;
    b.base[o] = b.x[i];
    b.base[o + 1] = b.y[i];
    b.base[o + 2] = b.r[i];
    b.base[o + 3] = 0.7 * (0.9 + 0.2 * h4) * limp;
    const lean = 0.02 + 0.05 * h2;
    b.seeds[o] = h1 * 10 + h3;
    b.seeds[o + 1] = Math.cos(h4 * 6.283) * lean;
    b.seeds[o + 2] = Math.sin(h4 * 6.283) * lean;
    b.special[i] = (h2 > 0.965) ? 1 : 0;
    b.seeds[o + 3] = b.special[i] ? 1.0 : 0.0;

    b.popped[i] = b.armed[i] = 0;
    b.press[i] = b.pop[i] = b.wob[i] = b.wobV[i] = 0;
    b.ox[i] = b.oy[i] = b.ovx[i] = b.ovy[i] = 0;
    b.cx[i] = b.cy[i] = 0;
    b.age[i] = 1;
  }

  _initSpecks() {
    const s = {
      next: 0,
      pos: new Float32Array(SPECKS * 3),
      par: new Float32Array(SPECKS * 3),
      special: new Uint8Array(SPECKS),
      vx: new Float32Array(SPECKS),
      vy: new Float32Array(SPECKS),
      age: new Float32Array(SPECKS).fill(1),
      life: new Float32Array(SPECKS).fill(1),
      size: new Float32Array(SPECKS),
      live: 0,
    };
    const g = new THREE.BufferGeometry();
    s.posAttr = new THREE.BufferAttribute(s.pos, 3).setUsage(THREE.DynamicDrawUsage);
    s.parAttr = new THREE.BufferAttribute(s.par, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', s.posAttr);
    g.setAttribute('aSpeck', s.parAttr);
    const pts = new THREE.Points(g, this.speckMat);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.scene.add(pts);
    this.specks = s;
    this.speckPoints = pts;
  }

  // ----------------------------------------------------------------- input

  _bind() {
    const c = this.canvas;
    const opt = { passive: false };
    c.addEventListener('pointerdown', this._onDown, opt);
    c.addEventListener('pointermove', this._onMove, opt);
    c.addEventListener('pointerup', this._onUp, opt);
    c.addEventListener('pointercancel', this._onUp, opt);
    c.addEventListener('pointerleave', this._onLeave, opt);
    c.addEventListener('wheel', this._onWheel, opt);
    c.addEventListener('touchstart', this._onTouchStart, { passive: true });
    c.addEventListener('touchmove', this._block, opt);
    c.addEventListener('contextmenu', this._block, opt);
    window.addEventListener('resize', this._onResize);
  }

  _onTouchStart = () => {
    if (this.interactive) {
      this.handlers.onPress?.();
    }
  };
  _block = (e) => e.preventDefault();
  _onResize = () => this.resize();

  // A roll only feeds one way: scrolling pulls fresh wrap up from below.
  _onWheel = (e) => {
    e.preventDefault();
    if (!this.interactive || this.opt.endless !== 'roll' || e.deltaY <= 0) return;
    this.scrollTarget = Math.min(this.scrollTarget + Math.min(e.deltaY, 160), this.scroll + this.h);
    this.wake();
  };

  _locate(e, p) {
    const rect = this.canvas.getBoundingClientRect();
    p.x = e.clientX - rect.left;
    p.y = -(e.clientY - rect.top);
  }

  _pointer(e) {
    let p = this.pointers.get(e.pointerId);
    if (!p) {
      p = { x: 0, y: 0, down: false, mouse: e.pointerType === 'mouse', bubble: -1 };
      this._locate(e, p);
      this.pointers.set(e.pointerId, p);
    }
    return p;
  }

  // Fingers are blunt: touches reach a little further than a mouse does.
  _pick(x, y, mouse) {
    const b = this.b;
    const reach = mouse ? 1.06 : 1.22;
    const sy = y - this.scroll;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < b.n; i++) {
      const dx = x - b.x[i];
      const dy = sy - b.y[i];
      const d = dx * dx + dy * dy;
      const r = b.r[i] * reach;
      if (d < r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  _arm(i, quick) {
    const b = this.b;
    if (i < 0 || b.popped[i] || b.armed[i]) return;
    b.armed[i] = 1;
    b.armAt[i] = this.time;
    b.popAt[i] = this.time + b.delay[i] * FEEL[this.opt.feel] * (quick ? 0.55 : 1);
  }

  _onDown = (e) => {
    if (!this.interactive) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    const p = this._pointer(e);
    this._locate(e, p);
    p.down = true;
    p.bubble = this._pick(p.x, p.y, p.mouse);
    this.canvas.classList.add('pressing');
    this.handlers.onPress?.();
    if (p.bubble >= 0) {
      if (this.b.popped[p.bubble]) {
        this.handlers.onDud?.({ pan: this._pan(this.b.x[p.bubble]) });
      } else {
        this._arm(p.bubble, false);
      }
    }
    this.wake();
  };

  _onMove = (e) => {
    if (!this.interactive) return;
    const known = this.pointers.has(e.pointerId);
    if (!known && e.pointerType !== 'mouse') return;
    const p = this._pointer(e);
    const px = p.x;
    const py = p.y;
    this._locate(e, p);
    if (p.down) {
      // Sweep the path so a fast drag doesn't skip bubbles between samples.
      const d = Math.hypot(p.x - px, p.y - py);
      const steps = Math.min(24, Math.ceil(d / (this.pitch * 0.3)));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        this._arm(this._pick(mix(px, p.x, t), mix(py, p.y, t), p.mouse), true);
      }
    }
    const hit = this._pick(p.x, p.y, p.mouse);
    if (p.down && hit !== p.bubble) this._arm(hit, true);
    p.bubble = hit;
    this.wake();
  };

  _onUp = (e) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.down = false;
    if (!p.mouse) this.pointers.delete(e.pointerId);
    let any = false;
    for (const q of this.pointers.values()) any = any || q.down;
    if (!any) this.canvas.classList.remove('pressing');
    this.wake();
  };

  _onLeave = (e) => {
    const p = this.pointers.get(e.pointerId);
    if (p && !p.down) this.pointers.delete(e.pointerId);
    this.wake();
  };

  // ------------------------------------------------------------------- pop

  _pan(x) {
    return clamp((x / this.w) * 2 - 1, -1, 1);
  }

  _pop(i) {
    const b = this.b;
    const strong = b.strong[i] === 1;
    const special = b.special && b.special[i] === 1;
    const gentle = 1 - 0.35 * this.calm;
    b.popped[i] = 1;
    b.armed[i] = 0;
    b.age[i] = 0;
    b.wobV[i] -= (strong ? 10 : 6.5) * gentle;
    b.regrowAt[i] = this.time + 3.5 + Math.random() * 5;
    this.lastPopT = this.time;
    // On the roll a sheet is worth exactly half a metre, however many edge
    // bubbles get caught, so stop counting once it has earned that.
    const worth = this.opt.endless === 'roll' ? Math.max(0, Math.min(this.perPop, SHEET_MM - this.accrued)) : this.perPop;
    this.accrued += worth;

    const x = b.x[i];
    const y = b.y[i] + this.scroll;
    const power = (strong ? 1.7 : 1) * gentle;

    // The sheet is one piece of plastic: the film tilts in a ring that runs
    // outward, and the neighbours get tugged as it passes.
    const u = this.uniforms.uRipples.value[this.rippleSlot];
    this.rippleSlot = (this.rippleSlot + 1) % 4;
    u.set(x, y, this.time, power);
    const reach = b.pitch * 3.3;
    for (let j = 0; j < b.n; j++) {
      if (j === i) continue;
      const dx = b.x[j] - b.x[i];
      const dy = b.y[j] - b.y[i];
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      const k = d / b.pitch;
      this.pending.push({
        j,
        at: this.time + d / (b.pitch * 15),
        nx: dx / d,
        ny: dy / d,
        s: power / (1 + k * k * 0.9),
      });
    }

    this._specks(x, y, b.r[i], strong, gentle, special);

    this.handlers.onPop?.({
      strong,
      pan: this._pan(x),
      size: b.size[i] * SIZE[this.opt.size],
      calm: this.calm,
      length: worth,
      special,
    });
  }

  _specks(x, y, r, strong, gentle, isSpecial = false) {
    const s = this.specks;
    const count = Math.round((strong || isSpecial ? 10 : 4 + Math.random() * 3) * gentle);
    for (let k = 0; k < count; k++) {
      const i = s.next;
      s.next = (s.next + 1) % SPECKS;
      const a = Math.random() * Math.PI * 2;
      const sp = this.pitch * (1.4 + Math.random() * 3.2) * (strong || isSpecial ? 1.35 : 1);
      s.pos[i * 3] = x + Math.cos(a) * r * 0.35;
      s.pos[i * 3 + 1] = y + Math.sin(a) * r * 0.35;
      s.pos[i * 3 + 2] = r * 0.4;
      s.vx[i] = Math.cos(a) * sp;
      s.vy[i] = Math.sin(a) * sp;
      s.special[i] = isSpecial ? 1 : 0;
      s.age[i] = 0;
      s.life[i] = 0.14 + Math.random() * 0.22;
      s.size[i] = (1.3 + Math.random() * 1.7) * (isSpecial ? 1.4 : 1);
    }
    s.live = 0.45;
  }

  // ------------------------------------------------------------------ loop

  wake() {
    this.awake = true;
    this.quiet = 0;
  }

  _tick = (ms) => {
    this._raf = requestAnimationFrame(this._tick);
    const now = ms / 1000;
    const dt = Math.min(0.034, Math.max(0, now - this.last));
    this.last = now;
    if (!this.awake || !this.b) return;

    this.time += dt;
    const energy = this._step(dt);
    this.uniforms.uTime.value = this.time;
    this.renderer.render(this.scene, this.camera);

    // Nothing moving: stop drawing until the next touch.
    this.quiet = energy < 0.002 ? this.quiet + dt : 0;
    if (this.quiet > 0.9) this.awake = false;
  };

  _step(dt) {
    const b = this.b;
    const t = this.time;
    const mode = this.opt.endless;
    let energy = 0;

    // Calm drifts in slowly; mood follows it.
    if (Math.abs(this.calmTarget - this.calm) > 0.0005) {
      this.calm += (this.calmTarget - this.calm) * ease(0.9, dt);
      this._applyMood();
      energy += 1;
    }

    // Feeding the roll.
    const gap = this.scrollTarget - this.scroll;
    const rolling = gap > 0.3;
    if (rolling) {
      this.scroll += gap * ease(4.2, dt);
      energy += 1;
    } else if (gap !== 0) {
      this.scroll = this.scrollTarget;
    }
    this.uniforms.uScroll.value = this.scroll;
    if (rolling) {
      for (const p of this.pointers.values()) p.bubble = this._pick(p.x, p.y, p.mouse);
    } else if (mode === 'roll' && this.interactive && (this.feedCheck += dt) > 0.3) {
      // Nearly used up and the hands have paused: bring up fresh wrap.
      this.feedCheck = 0;
      if (t - this.lastPopT > 0.5 && t - this.lastPopT < 4 && this.fraction() >= 0.92) this.feed(true);
    }

    // What each finger is asking of the bubble beneath it.
    b.tgt.fill(0);
    let ps = 0;
    let px = this.ptr.x;
    let py = this.ptr.y;
    for (const p of this.pointers.values()) {
      const s = p.down ? 1 : p.mouse ? 0.3 : 0;
      if (s > ps) {
        ps = s;
        px = p.x;
        py = p.y;
      }
      const i = p.bubble;
      if (i < 0) continue;
      const want = p.down ? (b.popped[i] ? 0.6 : 1) : p.mouse && !b.popped[i] ? 0.17 : 0;
      if (want > b.tgt[i]) {
        b.tgt[i] = want;
        let qx = (p.x - b.x[i]) / b.r[i];
        let qy = (p.y - this.scroll - b.y[i]) / b.r[i];
        const ql = Math.hypot(qx, qy);
        if (ql > 0.55) {
          qx *= 0.55 / ql;
          qy *= 0.55 / ql;
        }
        b.tcx[i] = qx;
        b.tcy[i] = qy;
      }
    }
    const ptr = this.ptr;
    if (ptr.s < 0.02) {
      ptr.x = px;
      ptr.y = py;
    } else {
      const k = ease(30, dt);
      ptr.x += (px - ptr.x) * k;
      ptr.y += (py - ptr.y) * k;
    }
    ptr.s += (ps - ptr.s) * ease(ps > ptr.s ? 26 : 9, dt);
    if (Math.abs(ps - ptr.s) > 0.004) energy += 1;
    this.uniforms.uPointer.value.set(ptr.x, ptr.y, ptr.s);

    // Ripple arriving at the neighbours.
    const pend = this.pending;
    if (pend.length) {
      energy += 1;
      let w = 0;
      for (let k = 0; k < pend.length; k++) {
        const e = pend[k];
        if (e.at > t) {
          pend[w++] = e;
          continue;
        }
        const v = e.s * b.pitch * 2.6;
        b.ovx[e.j] += e.nx * v;
        b.ovy[e.j] += e.ny * v;
        b.wobV[e.j] += e.s * 5;
      }
      pend.length = w;
    }

    const A = this.dynA.array;
    const B = this.dynB.array;
    const kUp = ease(48, dt);
    const kDown = ease(20, dt);
    const kPop = ease(75, dt);
    const kGrow = ease(4.5, dt);
    const kC = ease(34, dt);
    const sub = dt / 2;
    const gone = this.pitch * 1.6 - this.scroll;
    let moved = false;

    for (let i = 0; i < b.n; i++) {
      // Wrap that has left over the top comes back around as new wrap below.
      if (b.y[i] > gone) {
        b.keys.delete(b.col[i] + ',' + b.row[i]);
        this._place(i, b.col[i], b.row[i] + this.rows);
        moved = true;
      }

      let tg = b.tgt[i];
      if (b.armed[i]) {
        // Resistance: the film gives fast, then stiffens until it fails.
        const k = clamp((t - b.armAt[i]) / (b.popAt[i] - b.armAt[i]), 0, 1);
        tg = 0.56 + 0.44 * k * k;
        energy += 1;
        if (t >= b.popAt[i]) this._pop(i);
      }
      const press = b.press[i];
      const np = press + (tg - press) * (tg > press ? kUp : kDown);
      b.press[i] = np;
      energy += Math.abs(tg - np);

      if (tg > 0) {
        b.cx[i] += (b.tcx[i] - b.cx[i]) * kC;
        b.cy[i] += (b.tcy[i] - b.cy[i]) * kC;
      }

      if (b.popped[i]) {
        if (b.pop[i] < 0.9995) {
          b.pop[i] += (1 - b.pop[i]) * kPop;
          energy += 1;
        } else {
          b.pop[i] = 1;
        }
        if (b.age[i] < 1) {
          b.age[i] = Math.min(1, b.age[i] + dt);
          if (b.age[i] < 0.4) energy += 1;
        }
        if (mode === 'regrow') {
          energy += 1;
          if (t >= b.regrowAt[i] && tg === 0) {
            b.popped[i] = 0;
            b.age[i] = 1;
            b.wobV[i] += 2.5;
          }
        }
      } else if (b.pop[i] > 0) {
        // Air creeping back in.
        b.pop[i] -= b.pop[i] * kGrow;
        if (b.pop[i] < 0.003) b.pop[i] = 0;
        energy += 1;
      }

      // Springs: film wobble and the bubble's seat on the sheet.
      let wob = b.wob[i];
      let wv = b.wobV[i];
      let ox = b.ox[i];
      let oy = b.oy[i];
      let vx = b.ovx[i];
      let vy = b.ovy[i];
      if (wob !== 0 || wv !== 0 || vx !== 0 || vy !== 0 || ox !== 0 || oy !== 0) {
        for (let s = 0; s < 2; s++) {
          wv += (-2704 * wob - 23 * wv) * sub;
          wob += wv * sub;
          vx += (-1936 * ox - 25 * vx) * sub;
          vy += (-1936 * oy - 25 * vy) * sub;
          ox += vx * sub;
          oy += vy * sub;
        }
        const e = Math.abs(wob) + Math.abs(wv) * 0.02 + (Math.abs(ox) + Math.abs(oy)) * 0.2 + (Math.abs(vx) + Math.abs(vy)) * 0.004;
        if (e < 0.0008) {
          wob = wv = ox = oy = vx = vy = 0;
        } else {
          energy += e;
        }
        b.wob[i] = wob;
        b.wobV[i] = wv;
        b.ox[i] = ox;
        b.oy[i] = oy;
        b.ovx[i] = vx;
        b.ovy[i] = vy;
      }

      const o = i * 4;
      A[o] = np;
      A[o + 1] = b.pop[i];
      A[o + 2] = clamp(wob, -0.4, 0.4);
      A[o + 3] = b.age[i];
      B[o] = b.cx[i];
      B[o + 1] = b.cy[i];
      B[o + 2] = ox;
      B[o + 3] = oy;
    }
    this.dynA.needsUpdate = true;
    this.dynB.needsUpdate = true;
    if (moved) {
      this.baseAttr.needsUpdate = true;
      this.seedAttr.needsUpdate = true;
    }

    // Air specks.
    const s = this.specks;
    if (s.live > 0) {
      s.live -= dt;
      energy += 1;
      const drag = Math.exp(-9 * dt);
      for (let i = 0; i < SPECKS; i++) {
        if (s.age[i] >= s.life[i]) {
          s.par[i * 3 + 1] = 0;
          continue;
        }
        s.age[i] += dt;
        s.vx[i] *= drag;
        s.vy[i] *= drag;
        s.pos[i * 3] += s.vx[i] * dt;
        s.pos[i * 3 + 1] += s.vy[i] * dt;
        const k = clamp(s.age[i] / s.life[i], 0, 1);
        s.par[i * 3] = s.size[i] * (1 + k * 0.8);
        s.par[i * 3 + 1] = 0.42 * (1 - k) * (1 - k);
        s.par[i * 3 + 2] = s.special[i] ? 1 : 0;
      }
      s.posAttr.needsUpdate = true;
      s.parAttr.needsUpdate = true;
    }

    return energy;
  }

  _setTheme() {
    const s = THEMES.find((x) => x.id === this.opt.theme) || THEMES[0];
    const u = this.uniforms;
    const amt = 1 - Math.min(s.tint[0], s.tint[1], s.tint[2]);
    u.uTint.value.setRGB(s.tint[0], s.tint[1], s.tint[2]);
    u.uTintAmt.value = Math.min(1, amt * 3.5);
    // Coloured film scatters its own colour; clear film scatters cool white.
    u.uFilm.value.setRGB(0.9, 0.93, 0.96).lerp(u.uTint.value, Math.min(1, amt * 2.2));
    const [a0, a1, b0, b1] = this.bg;
    a0.copy(display(s.a));
    b0.copy(display(s.b));
    // Wound down, the same table reads a little warmer and lighter.
    a1.copy(a0).lerp(WARM, 0.4);
    b1.copy(b0).lerp(WARM, 0.25);
    this.uniforms.uTex.value = s.tex;
    this._applyMood();
  }

  _applyMood() {
    const c = this.calm;
    const u = this.uniforms;
    u.uBgA.value.lerpColors(this.bg[0], this.bg[1], c);
    u.uBgB.value.lerpColors(this.bg[2], this.bg[3], c);
    u.uKeyCol.value.lerpColors(LIGHT.key[0], LIGHT.key[1], c);
    u.uAmb.value.lerpColors(LIGHT.amb[0], LIGHT.amb[1], c);
    u.uKeyPow.value = mix(LIGHT.keyPow[0], LIGHT.keyPow[1], c);
    u.uGround.value.copy(u.uBgA.value).multiplyScalar(0.9);
  }

  // ------------------------------------------------------------------- api

  /** Share of the bubbles on screen that have been popped. */
  fraction() {
    const b = this.b;
    let seen = 0;
    let gone = 0;
    for (let i = 0; i < b.n; i++) {
      const y = b.y[i] + this.scroll;
      if (b.x[i] < 0 || b.x[i] > this.w || y > 0 || y < -this.h) continue;
      seen++;
      gone += b.popped[i];
    }
    return seen ? gone / seen : 0;
  }

  /**
   * Pull a screenful of fresh wrap off the roll. A sheet that was used up
   * (finished = true) is rounded up to its full half metre; one that was
   * skipped by hand only counts for what was actually popped on it.
   */
  feed(finished = false) {
    if (this.scrollTarget - this.scroll > this.h * 0.5) return;
    this.scrollTarget += Math.ceil((this.h * 0.9) / this.rowH) * this.rowH;
    const length = finished ? Math.max(0, SHEET_MM - this.accrued) : 0;
    this.accrued = 0;
    this.handlers.onFeed?.({ length });
    this.wake();
  }

  setOptions(next) {
    const prev = this.opt;
    this.opt = { ...prev, ...next };
    if (this.opt.theme !== prev.theme) this._setTheme();
    if (this.opt.size !== prev.size) this._build(false);
    if (this.opt.endless === 'regrow' && prev.endless !== 'regrow') {
      const b = this.b;
      for (let i = 0; i < b.n; i++) b.regrowAt[i] = this.time + 1 + Math.random() * 5;
    }
    this.wake();
  }

  setCalm(v) {
    this.calmTarget = clamp(v, 0, 1);
    this.wake();
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) {
      this.pointers.clear();
      this.canvas.classList.remove('pressing');
    }
    this.wake();
  }

  /** Pop bubble directly under client coordinates (px). */
  popAtPoint(clientX, clientY) {
    if (!this.interactive || !this.b) return false;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = -(clientY - rect.top);
    const hit = this._pick(x, y, true);
    if (hit >= 0 && !this.b.popped[hit] && !this.b.armed[hit]) {
      this._arm(hit, false);
      this.wake();
      return true;
    }
    return false;
  }

  /** Pop nearest unpopped bubble at normalized (0..1) screen coordinates. */
  popAtNormalized(nx, ny) {
    if (!this.interactive || !this.b) return false;
    const x = clamp(nx, 0.02, 0.98) * this.w;
    const y = -clamp(ny, 0.05, 0.95) * this.h;
    const b = this.b;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < b.n; i++) {
      if (b.popped[i] || b.armed[i]) continue;
      const sy = b.y[i] + this.scroll;
      if (sy > 0 || sy < -this.h) continue;
      const dx = x - b.x[i];
      const dy = y - sy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      this._arm(best, false);
      this.wake();
      return true;
    }
    return false;
  }

  /** Pop random unpopped bubble visible on screen. */
  popRandomOnScreen() {
    if (!this.interactive || !this.b) return false;
    const b = this.b;
    const candidates = [];
    for (let i = 0; i < b.n; i++) {
      if (b.popped[i] || b.armed[i]) continue;
      const sy = b.y[i] + this.scroll;
      if (sy <= 0 && sy >= -this.h && b.x[i] >= 0 && b.x[i] <= this.w) {
        candidates.push(i);
      }
    }
    if (candidates.length > 0) {
      const idx = candidates[Math.floor(Math.random() * candidates.length)];
      this._arm(idx, false);
      this.wake();
      return true;
    }
    return false;
  }

  /** Swap in a different sheet on the spot. */
  reset() {
    this.sheetSeed = (Math.random() * 1e6) | 0;
    this.accrued = 0;
    this._build(false);
    this.wake();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('pointerleave', this._onLeave);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('touchstart', this._onTouchStart);
    c.removeEventListener('touchmove', this._block);
    c.removeEventListener('contextmenu', this._block);
    window.removeEventListener('resize', this._onResize);
    this.bubbles?.geometry.dispose();
    this.sheet?.geometry.dispose();
    this.speckPoints.geometry.dispose();
    this.sheetMat.dispose();
    this.bubbleMat.dispose();
    this.speckMat.dispose();
    this.renderer.dispose();
  }
}
