// GLSL for the three draw calls: the flat film + table, the instanced bubbles,
// and the air specks. World units are CSS pixels on the z = 0 plane.

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uPitch;
uniform float uScroll;      // how far the roll has been fed, px
uniform float uWrinkle;
uniform vec4 uRipples[4];   // x, y, start time, strength
uniform vec3 uPointer;      // x, y, pressure
uniform vec3 uKeyDir;
uniform vec3 uKeyX;
uniform vec3 uKeyY;
uniform vec3 uKeyCol;
uniform float uKeyPow;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform vec3 uAmb;
uniform vec3 uGround;
uniform vec3 uBgA;
uniform vec3 uTint;         // what the film lets through
uniform float uTintAmt;     // 0 clear film, 1 coloured film
uniform vec2 uStrip;        // left and right edge of the strip of wrap

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Quintic value noise: smooth enough that reflections don't show the lattice.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Height of the slack, slightly wrinkled film. Long diagonal folds plus a
// little fine unevenness. p is in sheet coordinates (it travels with the roll).
float wrinkle(vec2 p) {
  p *= 88.0 / uPitch;
  vec2 a = vec2(dot(p, vec2(0.82, 0.57)), dot(p, vec2(-0.57, 0.82)));
  float h = vnoise(a * vec2(0.0034, 0.0150));
  h += 0.55 * vnoise(a.yx * vec2(0.0190, 0.0046) + vec2(7.3, 2.1));
  h += 0.14 * vnoise(p * 0.045 + 3.7);
  return h;
}

vec2 wrinkleSlope(vec2 p) {
  float e = 1.5;
  float h = wrinkle(p);
  // Folds scale with the bubbles, so their steepness has to be scaled back.
  return vec2(wrinkle(p + vec2(e, 0.0)) - h, wrinkle(p + vec2(0.0, e)) - h) / e * uWrinkle * (uPitch / 88.0);
}

// Travelling tilt of the sheet: pop ripples and the dent under the finger.
vec2 dynTilt(vec2 p) {
  vec2 t = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 0.8) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 0.001;
    float x = (dist - age * uPitch * 15.0) / (uPitch * 0.85);
    float ring = exp(-x * x) * x * 2.33;
    float fall = exp(-age * 5.0) / (1.0 + dist / (uPitch * 2.2));
    t += (d / dist) * ring * fall * r.w * 0.26;
  }
  vec2 dp = p - uPointer.xy;
  float g = exp(-dot(dp, dp) / (uPitch * uPitch * 1.7));
  t -= (dp / uPitch) * g * uPointer.z * 0.14;
  return t;
}

// The room the plastic reflects: a two-pane window, a small lamp opposite,
// and a dim ceiling. Directions below the horizon see the table.
vec3 env(vec3 d) {
  float w = dot(d, uKeyDir);
  float u = dot(d, uKeyX);
  float v = dot(d, uKeyY);
  float front = smoothstep(0.0, 0.25, w);
  float box = smoothstep(0.46, 0.20, abs(u)) * smoothstep(0.31, 0.10, abs(v)) * front;
  box *= 1.0 - 0.45 * smoothstep(0.04, 0.0, abs(u + 0.03));
  float glow = exp(-(u * u * 3.0 + v * v * 5.0)) * front;
  vec3 c = uKeyCol * uKeyPow * (box + glow * 0.2);
  c += uFillCol * smoothstep(0.90, 0.985, dot(d, uFillDir));
  c += mix(uGround, uAmb * (0.45 + 0.55 * d.z), smoothstep(-0.15, 0.3, d.z));
  return c;
}
`;

const BUBBLE_SHAPE = /* glsl */ `
// Thin, sharp folds: what slack film looks like once the air is gone.
float crumple(vec2 q, float seed) {
  vec2 p = mat2(0.86, 0.51, -0.51, 0.86) * q * 2.1 + seed * vec2(37.1, 91.7);
  p += 0.5 * vec2(vnoise(p * 1.3 + 3.1), vnoise(p * 1.3 + 8.7));
  float a = 1.0 - abs(2.0 * vnoise(p) - 1.0);
  float b = 1.0 - abs(2.0 * vnoise(mat2(0.6, 0.8, -0.8, 0.6) * p * 2.2 + 11.0) - 1.0);
  a *= a * a;
  return a * a * 0.7 + b * b * b * b * 0.3;
}

// Film height over the bubble's unit disc, in radii.
// dyn = (press, pop, wobble, pop age), c = contact point, sd = (seed, lean.xy)
float bubbleZ(vec2 q, vec4 dyn, vec2 c, float H, vec3 sd) {
  float rho = length(q);
  float rc = min(rho, 1.0);
  float rc2 = rc * rc;
  vec2 d = q - c;
  float g = exp(-dot(d, d) * 3.2);

  // Inflated: a short drum with steep walls and a barely domed top.
  float wall = sqrt(max(1.0 - rc2 * rc2 * rc, 0.0));
  float prof = 0.84 * wall + 0.16 * (1.0 - rc2);

  // The film isn't taut. Each bubble carries its own soft dents, which is
  // what makes the highlights wander instead of sitting like they do on glass.
  vec2 np = q * 1.5 + sd.x * vec2(3.1, 7.7);
  float dent = (vnoise(np) - 0.5) + 0.5 * (vnoise(np * 2.1 + 4.0) - 0.5);
  float slack = 0.05 + 0.10 * fract(sd.x * 3.7);

  float z = H * (1.0 + dyn.z * 0.5) * prof * (1.0 + dot(q, sd.yz)) * (1.0 + slack * dent);
  // Pressing dents the film under the finger and shoves the air sideways.
  z *= (1.0 - 0.76 * dyn.x * g) * (1.0 + 0.16 * dyn.x * (1.0 - g));

  if (dyn.y > 0.001) {
    // Popped: film lying nearly flat, creased, with a fold where the wall fell in.
    float cr = crumple(q, sd.x);
    // The fold wanders in and out and comes and goes around the rim.
    float fn = vnoise(q * 2.2 + sd.x * 5.0);
    float fold = exp(-pow((rc - (0.70 + 0.22 * fn)) / 0.07, 2.0)) * smoothstep(0.35, 0.75, vnoise(q * 1.7 + sd.x * 9.0));
    float flat_ = H * (0.02 + (0.11 + dyn.z * 0.3) * cr * (1.0 - rc2) + 0.07 * fold);
    flat_ *= (1.0 - 0.5 * dyn.x * g) * smoothstep(1.0, 0.93, rc);
    z = mix(z, flat_, dyn.y);
  }

  // Small fillet where the bubble film meets the flat sheet.
  return z + 0.04 * (1.0 - 0.6 * dyn.y) * smoothstep(1.10, 0.97, rho);
}
`;

export const SHEET_VERT = /* glsl */ `
${COMMON}
varying vec2 vP;
varying vec2 vTilt;
void main() {
  vP = position.xy;
  vTilt = dynTilt(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHEET_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uBgB;
uniform vec3 uFilm;
uniform vec3 uView;   // viewport centre xy, half diagonal
uniform float uTex;   // how much grain the table has
varying vec2 vP;
varying vec2 vTilt;
void main() {
  vec3 N = normalize(vec3(-wrinkleSlope(vP - vec2(0.0, uScroll)) + vTilt, 1.0));
  vec3 V = normalize(cameraPosition - vec3(vP, 0.0));
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);

  // The table stays put while the plastic slides over it.
  vec2 c = (vP - uView.xy) / uView.z;
  float vig = smoothstep(0.15, 1.2, length(c));
  vec3 table = mix(uBgA, uBgB, vig * 0.55);
  table *= 1.0 + 0.16 * dot(c, normalize(uKeyDir.xy));
  float grain = (vnoise(vP * vec2(0.07, 1.1)) - 0.5) + 0.6 * (vnoise(vP * 0.7 + 9.0) - 0.5);
  table *= 1.0 + uTex * grain;

  float ndl = clamp(dot(N, uKeyDir), 0.0, 1.0);
  vec3 filmed = table * uTint * 0.9
    + uFilm * (uAmb * 2.4 + uKeyCol * 0.9 * ndl) * (0.055 + 0.06 * uTintAmt)
    + env(reflect(-V, N)) * F;

  // The wrap is a strip off a roll: cut edges left and right, hand-straight.
  float sy = vP.y - uScroll;
  float dl = vP.x - uStrip.x + (vnoise(vec2(sy * 0.011, 3.0)) - 0.5) * 3.0;
  float dr = uStrip.y - vP.x + (vnoise(vec2(sy * 0.011, 17.0)) - 0.5) * 3.0;
  float inside = smoothstep(-0.7, 0.7, min(dl, dr));
  // The cut edge catches the window on the near side and goes dull on the far one.
  filmed += uKeyCol * (0.30 * exp(-dl * dl * 0.35) + 0.08 * exp(-dr * dr * 0.35));

  // Bare table beside it, with the strip's shadow falling away from the light.
  float shade = 0.34 * exp(min(dr, 0.0) / 13.0) * step(dr, 0.0)
              + 0.12 * exp(min(dl, 0.0) / 3.5) * step(dl, 0.0);
  vec3 bare = table * (1.0 - shade);

  vec3 col = mix(bare, filmed, inside);
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.014;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const BUBBLE_VERT = /* glsl */ `
${COMMON}
${BUBBLE_SHAPE}
attribute vec4 aBase;   // centre xy (sheet coords), radius, height
attribute vec4 aSeed;   // seed, lean xy, isSpecial
attribute vec4 aDynA;   // press, pop, wobble, pop age
attribute vec4 aDynB;   // contact xy, offset xy
varying vec2 vQ;
varying vec4 vDyn;
varying vec2 vC;
varying vec4 vSeed;
varying float vH;
varying vec3 vW;
varying vec2 vTilt;
void main() {
  vec2 q = position.xy;
  vec2 onSheet = aBase.xy + aDynB.zw;
  vec2 ctr = onSheet + vec2(0.0, uScroll);
  float z = bubbleZ(q, aDynA, aDynB.xy, aBase.w, aSeed.xyz);
  vec3 w = vec3(ctr + q * aBase.z, z * aBase.z);
  vQ = q;
  vDyn = aDynA;
  vC = aDynB.xy;
  vSeed = aSeed;
  vH = aBase.w;
  vW = w;
  vTilt = dynTilt(ctr) - wrinkleSlope(onSheet) * 0.7;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`;

export const BUBBLE_FRAG = /* glsl */ `
${COMMON}
${BUBBLE_SHAPE}
uniform vec3 uFilm;
varying vec2 vQ;
varying vec4 vDyn;
varying vec2 vC;
varying vec4 vSeed;
varying float vH;
varying vec3 vW;
varying vec2 vTilt;
void main() {
  vec2 q = vQ;
  float rho = length(q);
  float pop = vDyn.y;
  vec2 L2 = normalize(uKeyDir.xy);

  float e = 0.014;
  float z0 = bubbleZ(q, vDyn, vC, vH, vSeed.xyz);
  float zx = bubbleZ(q + vec2(e, 0.0), vDyn, vC, vH, vSeed.xyz);
  float zy = bubbleZ(q + vec2(0.0, e), vDyn, vC, vH, vSeed.xyz);
  vec3 N = normalize(vec3(vTilt - vec2(zx - z0, zy - z0) / e, 1.0));
  vec3 V = normalize(cameraPosition - vW);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float edge = pow(1.0 - nv, 1.4);

  // Soft polyethylene never turns into a mirror edge-on the way glass does.
  float F = 0.035 + 0.5 * pow(1.0 - nv, 4.0);
  vec3 refl = env(reflect(-V, N)) * F;
  // The fainter reflection off the inside of the far wall.
  refl += env(reflect(-V, normalize(vec3(-N.xy * 0.9, N.z)))) * 0.03 * (1.0 - 0.7 * pop);

  // Milky film: nearly clear face-on, cloudy white through the wall, and
  // never quite evenly cloudy.
  float cloud = 0.8 + 0.4 * vnoise(q * 4.0 + vSeed.x * 7.0);
  float haze = (0.07 + 0.11 * uTintAmt + 0.50 * edge) * cloud + 0.03 * pop;
  float ndl = clamp(dot(N, uKeyDir), 0.0, 1.0);
  // Light that crossed the bubble and glows in the wall on the far side.
  float back = pow(clamp(dot(-N.xy, L2), 0.0, 1.0), 2.0) * edge;
  vec3 hazeCol = uFilm * (uAmb * 2.4 + uKeyCol * (0.25 + 0.75 * ndl + 0.9 * back));

  float mask = smoothstep(1.11, 1.05, rho);
  vec3 film = (refl + hazeCol * haze) * mask;
  float a = clamp(haze + F * 0.8, 0.0, 1.0) * mask;

  float up = (1.0 - pop) * (1.0 - 0.4 * vDyn.x);

  // The bubble gathers a little light onto the table along its far edge.
  float caus = exp(-pow((length(q + L2 * 0.22) - 0.80) / 0.10, 2.0));
  caus *= pow(clamp(dot(q / (rho + 0.001), -L2), 0.0, 1.0), 3.0);
  film += uKeyCol * (uBgA * 0.8 + 0.04) * caus * up * mask;

  // Lucky / Golden bubble subtle warm rim glow & shimmer
  if (vSeed.w > 0.5) {
    float shine = 0.5 + 0.5 * sin(uTime * 2.8 + vSeed.x * 5.0);
    vec3 goldTint = vec3(1.0, 0.82, 0.35);
    film = mix(film, goldTint * (0.85 + 0.35 * edge), 0.40 * (1.0 - pop * 0.75));
    film += goldTint * pow(edge, 1.6) * 0.7 * (1.0 - pop) * (0.75 + 0.25 * shine);
  }

  // Puff of escaping air in the instant after the pop.
  float age = vDyn.w;
  if (pop > 0.0 && age < 0.38) {
    float k = age / 0.38;
    float ring = exp(-pow((rho - (0.35 + 1.25 * sqrt(k))) / 0.18, 2.0));
    vec3 puffCol = vSeed.w > 0.5 ? vec3(0.98, 0.86, 0.42) : vec3(0.55, 0.58, 0.62);
    film += puffCol * ring * (1.0 - k) * (1.0 - k) * 0.75 * smoothstep(1.5, 1.2, rho);
  }

  // Soft shadow thrown away from the light; it dies with the bubble.
  vec2 so = q + uKeyDir.xy / uKeyDir.z * vH * 0.55 * up;
  float sh = smoothstep(1.22, 0.92, length(so)) * (0.03 + 0.24 * up);
  sh *= mix(0.08, 1.0, smoothstep(0.9, 1.04, rho));
  sh += 0.05 * (1.0 - 0.6 * pop) * exp(-pow((rho - 1.04) / 0.05, 2.0));

  gl_FragColor = vec4(film, 1.0 - (1.0 - a) * (1.0 - sh));
}
`;

export const SPECK_VERT = /* glsl */ `
uniform float uDpr;
attribute vec3 aSpeck;   // size, alpha, isSpecial
varying float vA;
varying float vSpecial;
void main() {
  vA = aSpeck.y;
  vSpecial = aSpeck.z;
  gl_PointSize = aSpeck.x * uDpr;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SPECK_FRAG = /* glsl */ `
varying float vA;
varying float vSpecial;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vA;
  vec3 col = vSpecial > 0.5 ? vec3(1.0, 0.85, 0.32) : vec3(0.92, 0.95, 1.0);
  gl_FragColor = vec4(col * a, 0.0);
}
`;
