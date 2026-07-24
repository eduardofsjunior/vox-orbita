/**
 * WebGL2 fragment-shader backgrounds, all audio-reactive:
 *  - gradient-flow: hue/intensity follow energy
 *  - fbm-noise:     turbulence follows the spectral centroid
 *  - aurora:        soft radial curtains pulsing on beats
 *  - ripples:       water rings that propagate outward from each onset
 *  - neon-grid:     synthwave perspective grid, lines pulse with energy
 *  - hex:           honeycomb lattice, cells light with the envelope
 *  - contour:       drifting topographic contour lines
 *  - voronoi:       organic cell walls (dragonfly wing / cracked earth)
 *
 * All are pure functions of (uTime, per-frame feature uniforms), so preview
 * and export match exactly. Film grain is *static* (no time term) and user
 * controllable — animated grain reads as compression noise in exports.
 */

import { smoothedAt } from '../types';
import { hash01 } from '../prng';
import { defineLayer, hexToRgb01, resolveColor, type RenderCtx, type Schema } from './api';

export const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uRms;
uniform float uEnv;
uniform float uBeat;
uniform float uCentroid;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColBg;
uniform float uIntensity;
uniform float uGrain;
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }
  return v;
}
/* Static grain — breaks up banding without temporal shimmer. */
vec3 grain(vec3 col, vec2 uv) {
  return col + (hash(uv * uRes) - 0.5) * uGrain;
}
`;

const GRADIENT_FS = COMMON + `
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.07;
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t * 0.7 + 3.1));
  float m = fbm(p * 1.8 + q * (1.2 + uEnv * 1.4) + vec2(t * 0.5, -t * 0.3));
  float band = smoothstep(0.25, 0.85, m + uRms * 0.25);
  vec3 col = mix(uColBg, mix(uColA, uColB, clamp(m * 1.6 - 0.2 + uCentroid * 0.4, 0.0, 1.0)), band * uIntensity);
  col += uColB * uBeat * 0.08 * (1.0 - length(p));
  col *= 1.0 - dot(p, p) * 0.35;
  outColor = vec4(grain(col, uv), 1.0);
}`;

const FBM_FS = COMMON + `
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.05;
  float turb = 1.2 + uCentroid * 3.2;
  vec2 q = vec2(
    fbm(p * turb + vec2(t * 0.9, t * 0.4)),
    fbm(p * turb + vec2(-t * 0.6, t * 0.8) + 5.2)
  );
  float m = fbm(p * turb * 1.4 + q * (1.6 + uEnv * 1.2) - t * 0.4);
  float ridge = abs(m * 2.0 - 1.0);
  vec3 col = uColBg * 0.9;
  col = mix(col, uColA, smoothstep(0.15, 0.95, m) * uIntensity);
  col = mix(col, uColB, pow(1.0 - ridge, 4.0) * (0.35 + uRms * 0.65) * uIntensity);
  col *= 1.0 - dot(p, p) * 0.3;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

const AURORA_FS = COMMON + `
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.09;
  float r = length(p);
  float a = atan(p.y, p.x);
  vec3 col = uColBg * 0.85;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ring = 0.28 + fi * 0.16 + uBeat * 0.05 * (1.0 + fi * 0.4);
    float wob = fbm(vec2(a * (1.2 + fi * 0.5) + t * (0.7 + fi * 0.3), fi * 7.0 + t * 0.4)) - 0.5;
    float d = abs(r - ring - wob * 0.18);
    float band = exp(-d * d * (46.0 - uEnv * 18.0));
    vec3 tint = mix(uColA, uColB, fi * 0.5 + uCentroid * 0.3);
    col += tint * band * (0.16 + uRms * 0.3 + uBeat * 0.22) * uIntensity;
  }
  col += mix(uColA, uColB, 0.5) * exp(-r * r * 7.0) * uBeat * 0.35 * uIntensity;
  col *= 1.0 - r * r * 0.28;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

/** Up to 8 ripples × (age, strength, seed). age < 0 ⇒ slot unused. */
export const RIPPLE_SLOTS = 8;

const RIPPLES_FS = COMMON + `
uniform float uRipples[${RIPPLE_SLOTS * 3}];
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = uColBg * (0.92 - length(p) * 0.22);
  // Calm water sheen that breathes with the envelope.
  col += uColA * fbm(p * 2.2 + uTime * 0.03) * 0.05 * (0.4 + uEnv);
  for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
    float age = uRipples[i * 3];
    if (age < 0.0) continue;
    float str = uRipples[i * 3 + 1];
    float seed = uRipples[i * 3 + 2];
    vec2 c = vec2((fract(seed * 13.7) - 0.5) * 0.9, (fract(seed * 7.3) - 0.5) * 0.6);
    float rr = length(p - c);
    float speed = 0.32 + fract(seed * 3.1) * 0.22;
    float fade = max(0.0, 1.0 - age / 2.8);
    // Main ring + a trailing secondary ring, both thinning as they expand.
    for (int k = 0; k < 2; k++) {
      float radius = (age - float(k) * 0.16) * speed;
      if (radius < 0.0) continue;
      float sharp = 30.0 + radius * 26.0;
      float ring = exp(-pow((rr - radius) * sharp, 2.0));
      col += mix(uColA, uColB, fract(seed * 5.9)) * ring * fade * fade
           * (0.28 + str * 0.8) * (k == 0 ? 1.0 : 0.45) * uIntensity;
    }
  }
  outColor = vec4(grain(col, vUv), 1.0);
}`;

const NEONGRID_FS = COMMON + `
float neonLine(float v) {
  return pow(1.0 - min(abs(fract(v) - 0.5) * 2.0, 1.0), 22.0);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float horizon = 0.14;
  vec3 col = uColBg * 0.8;
  // Sky: soft gradient rising to the horizon.
  col += uColB * exp(-(p.y - horizon) * 3.2) * 0.10 * step(horizon, p.y);
  if (p.y < horizon) {
    float depth = horizon - p.y;
    float z = 1.0 / (depth * 2.6 + 0.015);
    float x = p.x * z;
    float zt = z * 0.5 + uTime * (1.4 + uRms * 1.2);
    float fade = smoothstep(0.0, 0.30, depth) * (1.0 / (1.0 + z * 0.06));
    float lines = neonLine(x * 1.7) * 0.9 + neonLine(zt * 1.3);
    col += uColA * lines * fade * (0.5 + uEnv * 0.7 + uBeat * 0.45) * uIntensity;
  }
  // Horizon glow flashes on beats.
  col += mix(uColA, uColB, 0.5) * exp(-abs(p.y - horizon) * 26.0) * (0.35 + uBeat * 0.5) * uIntensity;
  col *= 1.0 - dot(p, p) * 0.25;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

const HEX_FS = COMMON + `
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
}
vec4 hexTile(vec2 uv) {
  vec2 r = vec2(1.0, 1.73);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float scale = 6.5;
  vec2 drift = vec2(uTime * 0.04, uTime * 0.025);
  vec4 t = hexTile((p + drift) * scale);
  float e = 0.5 - hexDist(t.xy);
  float cellHash = hash(t.zw);
  // Each cell breathes with the envelope at its own phase; some cells
  // spark on beats.
  float glowPhase = 0.5 + 0.5 * sin(uTime * (0.5 + cellHash * 1.2) + cellHash * 6.28);
  float cellGlow = uEnv * glowPhase * 0.5 + uBeat * step(0.82, fract(cellHash * 9.7)) * 0.7;
  float border = smoothstep(0.10, 0.02, e);
  vec3 col = uColBg * 0.9;
  col += uColA * border * (0.16 + uRms * 0.5 + uBeat * 0.2) * uIntensity;
  col += mix(uColA, uColB, cellHash) * smoothstep(0.02, 0.28, e) * cellGlow * 0.5 * uIntensity;
  col *= 1.0 - dot(p, p) * 0.3;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

const CONTOUR_FS = COMMON + `
float contourLine(float f, float n) {
  float c = fract(f * n);
  return pow(1.0 - min(min(c, 1.0 - c) * 2.0, 1.0), 16.0);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float f = fbm(p * (1.25 + uCentroid * 0.7) + vec2(uTime * 0.05, -uTime * 0.035));
  vec3 col = uColBg * 0.92;
  // Minor contours in A, every 4th line heavier in B — a living topo map.
  col += uColA * contourLine(f, 16.0) * (0.20 + uRms * 0.55 + uBeat * 0.15) * uIntensity;
  col += uColB * contourLine(f, 4.0) * (0.30 + uEnv * 0.45) * uIntensity;
  // Faint elevation shading between the lines.
  col += mix(uColA, uColB, f) * f * 0.06 * uIntensity;
  col *= 1.0 - dot(p, p) * 0.3;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

const VORONOI_FS = COMMON + `
vec2 vhash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 uv = p * 3.4 + vec2(uTime * 0.05, 0.0);
  vec2 cell = floor(uv);
  vec2 fr = fract(uv);
  float f1 = 8.0;
  float f2 = 8.0;
  vec2 nearId = cell;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = vhash(cell + g);
      vec2 site = g + 0.5 + 0.32 * sin(uTime * 0.35 + h * 6.2831);
      float d = length(site - fr);
      if (d < f1) { f2 = f1; f1 = d; nearId = cell + g; }
      else if (d < f2) { f2 = d; }
    }
  }
  float wall = f2 - f1; // 0 at cell borders
  float border = smoothstep(0.10, 0.0, wall);
  float cellHash = hash(nearId);
  vec3 col = uColBg * 0.9;
  col += uColA * border * (0.22 + uRms * 0.6 + uBeat * 0.25) * uIntensity;
  // Interior shading + per-cell beat sparks.
  col += mix(uColA, uColB, cellHash) * (1.0 - f1) * 0.10 * (0.4 + uEnv) * uIntensity;
  col += uColB * step(0.86, fract(cellHash * 7.3)) * uBeat * 0.35 * uIntensity;
  col *= 1.0 - dot(p, p) * 0.3;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

export interface ShaderBgOptions {
  intensity?: number;
  grain?: number;
  /** Per-frame extra uniforms (e.g. onset-driven ripples). Deterministic! */
  extraUniforms?: (rc: RenderCtx) => Record<string, number | number[] | Float32Array>;
  /**
   * Extra slider/toggle controls for this shader. Each key `foo` is bound to
   * a `uFoo` uniform automatically (booleans become 0/1), so a 3D scene can
   * expose things like march quality or fractal fold without new plumbing.
   */
  extraSchema?: Schema;
}

/** Uniform name for an extra schema key: `fold` → `uFold`. */
function uniformName(key: string): string {
  return `u${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

export function makeShaderBg(id: string, frag: string, opts?: ShaderBgOptions) {
  const schema = {
    colorA: { kind: 'color', def: 'theme:a' },
    colorB: { kind: 'color', def: 'theme:b' },
    base: { kind: 'color', def: 'theme:bg' },
    intensity: { kind: 'slider', min: 0.1, max: 1.5, step: 0.05, def: opts?.intensity ?? 0.8 },
    motion: { kind: 'select', options: ['flow', 'loop', 'beat'], def: 'flow' },
    speed: { kind: 'slider', min: 0.1, max: 3, step: 0.05, def: 1 },
    reactivity: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.65 },
    smoothing: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
    grain: { kind: 'slider', min: 0, max: 1, step: 0.01, def: opts?.grain ?? 0.3 },
    ...(opts?.extraSchema ?? {}),
  } satisfies Schema;
  const extraKeys = Object.keys(opts?.extraSchema ?? {});
  return defineLayer({
    id,
    kind: 'background',
    schema,
    render(rc: RenderCtx, cfg) {
      const { glr, c2, w, h, features, frame, fps, theme } = rc;
      glr.resize(w, h);
      const prog = glr.getProgram(id, frag);

      // Animation clock, per the selected motion mode:
      //  - flow: advances linearly with playback time (classic).
      //  - loop: ping-pongs over a fixed period, so the animation cycles
      //    seamlessly instead of drifting forever into new territory.
      //  - beat: advances only when beats hit (integral of the beat
      //    envelope) — the background steps forward in sync with the music.
      let animTime: number;
      if (cfg.motion === 'loop') {
        const period = 16; // seconds out-and-back
        const t = (rc.time * cfg.speed) % period;
        animTime = period / 2 - Math.abs(t - period / 2);
      } else if (cfg.motion === 'beat') {
        animTime = beatClock(features, frame) * cfg.speed * 2.2;
      } else {
        animTime = rc.time * cfg.speed;
      }

      // The background is decoupled from the raw audio drive:
      //  - `smoothing` averages the features over up to ~1.5 s, removing
      //    frame-to-frame flicker while keeping the slow swell;
      //  - `reactivity` cross-fades toward neutral resting values — at 0 the
      //    background ignores the audio entirely and animates on time alone.
      const win = cfg.smoothing * 1.5 * fps;
      const react = (raw: number, neutral: number) => neutral + (raw - neutral) * cfg.reactivity;
      const rms = react(smoothedAt(features.rms, features.frameCount, frame, win), 0.3);
      const env = react(smoothedAt(features.env, features.frameCount, frame, win), 0.4);
      const beat = react(smoothedAt(features.beat, features.frameCount, frame, win), 0);
      const centroid = react(smoothedAt(features.centroid, features.frameCount, frame, win), 0.5);

      glr.drawQuad(prog, {
        uRes: [w, h],
        uTime: animTime,
        uRms: rms,
        uEnv: env,
        uBeat: beat,
        uCentroid: centroid,
        uColA: hexToRgb01(resolveColor(cfg.colorA, theme)),
        uColB: hexToRgb01(resolveColor(cfg.colorB, theme)),
        uColBg: hexToRgb01(resolveColor(cfg.base, theme)),
        uIntensity: cfg.intensity,
        uGrain: cfg.grain * 0.03,
        ...Object.fromEntries(
          extraKeys.map((k) => {
            const v = (cfg as Record<string, unknown>)[k];
            return [uniformName(k), typeof v === 'boolean' ? (v ? 1 : 0) : (v as number)];
          }),
        ),
        ...(opts?.extraUniforms ? opts.extraUniforms(rc) : {}),
      });
      glr.blit(c2);
    },
  });
}

// ---- Beat clock: animation time that advances with the music ----

/**
 * Cumulative integral of the beat envelope, in "beat seconds". Lazily cached
 * per FeatureTrack (pure function of the track — determinism intact).
 * Sampling interpolates between frames so beat-synced motion is fluid.
 */
const beatClockCache = new WeakMap<Float32Array, Float32Array>();

function beatClock(features: { beat: Float32Array; frameCount: number; fps: number }, frame: number): number {
  let cum = beatClockCache.get(features.beat);
  if (!cum) {
    cum = new Float32Array(features.frameCount);
    let acc = 0;
    for (let f = 0; f < features.frameCount; f++) {
      acc += features.beat[f];
      cum[f] = acc;
    }
    beatClockCache.set(features.beat, cum);
  }
  const clamped = Math.min(Math.max(frame, 0), features.frameCount - 1);
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, features.frameCount - 1);
  const t = clamped - lo;
  return (cum[lo] * (1 - t) + cum[hi] * t) / features.fps;
}

// ---- Onset-driven ripple uniforms (shared scratch, filled per frame) ----

const rippleScratch = new Float32Array(RIPPLE_SLOTS * 3);

function rippleUniforms(rc: RenderCtx): Record<string, Float32Array> {
  const { features, frame, fps } = rc;
  rippleScratch.fill(-1);
  const intFrame = Math.floor(Math.min(frame, features.frameCount - 1));
  const maxAgeFrames = Math.round(2.8 * fps);
  let slot = 0;
  // Newest onsets first; ages stay fractional for smooth expansion.
  for (let f0 = intFrame; f0 >= Math.max(0, intFrame - maxAgeFrames) && slot < RIPPLE_SLOTS; f0--) {
    if (!features.onsets[f0]) continue;
    rippleScratch[slot * 3] = (frame - f0) / fps;
    rippleScratch[slot * 3 + 1] = features.flux[f0];
    rippleScratch[slot * 3 + 2] = hash01(f0 + 1);
    slot++;
  }
  return { uRipples: rippleScratch };
}

export const bgGradientFlow = makeShaderBg('bg-gradient', GRADIENT_FS);
export const bgFbmNoise = makeShaderBg('bg-fbm', FBM_FS, { intensity: 0.7 });
export const bgAurora = makeShaderBg('bg-aurora', AURORA_FS, { intensity: 0.9 });
export const bgRipples = makeShaderBg('bg-ripples', RIPPLES_FS, { intensity: 1, extraUniforms: rippleUniforms });
export const bgNeonGrid = makeShaderBg('bg-neongrid', NEONGRID_FS, { intensity: 0.9 });
export const bgHex = makeShaderBg('bg-hex', HEX_FS, { intensity: 0.85 });
export const bgContour = makeShaderBg('bg-contour', CONTOUR_FS, { intensity: 0.85 });
export const bgVoronoi = makeShaderBg('bg-voronoi', VORONOI_FS, { intensity: 0.85 });
