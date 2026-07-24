/**
 * True-3D science-fiction backgrounds (WebGL2 fragment shaders).
 *
 * Unlike the flat pattern backgrounds in `bg-shaders.ts`, these build an
 * actual 3D scene per pixel and shade it with real perspective, normals and
 * distance fog:
 *
 *  - hyperspace : analytic ray↔cylinder corridor, panelled walls, light bands
 *                 racing toward the camera
 *  - megastruct : raymarched kaleidoscopic IFS — an endless alien structure
 *  - lattice3d  : raymarched gyroid crystal matrix with energy pulses
 *
 * All are pure functions of (uTime, per-frame feature uniforms), so preview
 * and export stay pixel-identical. Cost scales with resolution, so every
 * scene exposes a `quality` control that caps the march step count.
 */

import { COMMON, makeShaderBg } from './bg-shaders';

/** Camera basis + shared scene helpers appended to COMMON. */
const SCENE = `
uniform float uQuality;
uniform float uFov;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
/* Distance fog toward the background colour. */
vec3 fog(vec3 col, float dist, float density) {
  return mix(col, uColBg, 1.0 - exp(-dist * density));
}
`;

// ---------------------------------------------------------------- corridor

/**
 * Hyperspace corridor. The camera flies down an infinite cylinder; the wall
 * hit is solved analytically (exact, cheap, no marching) which keeps it fast
 * even at 4K. Panels, greebles and travelling light bands are procedural.
 */
const HYPERSPACE_FS = COMMON + SCENE + `
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;

  // Camera: looks down +z, banks slowly, drifts off the tunnel axis.
  vec3 rd = normalize(vec3(p / max(uFov, 0.25), 1.0));
  rd.xy = rot2(sin(t * 0.13) * 0.35) * rd.xy;
  vec2 drift = vec2(sin(t * 0.21), cos(t * 0.17)) * 0.34;
  float travel = t * (3.0 + uRms * 5.0);
  vec3 ro = vec3(drift, travel);

  // Ray ↔ infinite cylinder (radius R) — we are inside, so take the far root.
  float R = 1.0;
  float a = dot(rd.xy, rd.xy);
  float b = 2.0 * dot(ro.xy - vec2(0.0), rd.xy);
  float c = dot(ro.xy, ro.xy) - R * R;
  float disc = max(b * b - 4.0 * a * c, 0.0);
  float dist = (-b + sqrt(disc)) / max(2.0 * a, 1e-4);
  dist = min(dist, 90.0);

  vec3 hit = ro + rd * dist;
  float ang = atan(hit.y, hit.x);              // −π..π around the tube
  float depth = hit.z;

  // Panelling: ring segments × longitudinal plates.
  float rings = 16.0 + floor(uCentroid * 16.0);
  vec2 cell = vec2(ang / 6.2831 * rings, depth * 0.6);
  vec2 gv = fract(cell) - 0.5;
  vec2 id = floor(cell);
  float seam = smoothstep(0.5, 0.42, max(abs(gv.x), abs(gv.y)));
  float panel = hash13(vec3(id, 1.0));

  vec3 col = uColBg * 0.55;
  // Wall plates: dim, with a few brighter "lit" panels.
  col += uColB * (0.05 + panel * 0.10) * seam;
  col += uColA * step(0.93, panel) * (0.35 + uEnv * 0.5) * seam;
  // Seam glow between plates.
  col += uColA * (1.0 - seam) * (0.10 + uRms * 0.35);

  // Light bands racing toward the camera; beats add a bright shock front.
  float band = pow(0.5 + 0.5 * sin(depth * 1.1 - t * 6.0), 24.0);
  col += mix(uColA, uColB, 0.35) * band * (0.5 + uBeat * 1.6);
  float shock = pow(0.5 + 0.5 * sin(depth * 0.35 - t * 2.0), 40.0);
  col += uColB * shock * uBeat * 1.2;

  // Speed streaks near the walls read as motion blur at high energy.
  float streak = pow(abs(sin(ang * rings * 0.5 + t * 0.7)), 40.0);
  col += uColA * streak * uRms * 0.25;

  col = fog(col * uIntensity, dist, 0.055);
  // Vignette + bright vanishing point.
  col += mix(uColA, uColB, 0.5) * exp(-dot(p, p) * 26.0) * (0.25 + uBeat * 0.5) * uIntensity;
  col *= 1.0 - dot(p, p) * 0.25;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

// ------------------------------------------------------------- megastructure

/**
 * Kaleidoscopic IFS ("Kifs") megastructure: repeated fold + scale of space
 * produces an infinitely detailed alien architecture. The fold offset is
 * audio-reactive, so the structure visibly reconfigures with the music.
 */
const MEGASTRUCT_FS = COMMON + SCENE + `
uniform float uFold;
uniform float uIter;

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/*
 * Menger sponge: repeatedly punch cross-shaped holes out of a cube. This is
 * a well-behaved distance estimator (unlike a naive IFS fold), which is what
 * keeps the march clean instead of speckled.
 */
float mapScene(vec3 p, out float trap) {
  // Slow tumble so the structure reads as a solid object in space.
  p.xz = rot2(uTime * 0.12) * p.xz;
  p.xy = rot2(uTime * 0.07) * p.xy;

  float d = sdBox(p, vec3(1.0));
  trap = 1e9;
  float s = 1.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uIter) break;
    // Fold breathes with the music, so the lattice visibly reconfigures.
    float f = uFold + uEnv * 0.10;
    vec3 a = mod(p * s * f, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float cross = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, cross);
    trap = min(trap, cross);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  float tr;
  return normalize(vec3(
    mapScene(p + e.xyy, tr) - mapScene(p - e.xyy, tr),
    mapScene(p + e.yxy, tr) - mapScene(p - e.yxy, tr),
    mapScene(p + e.yyx, tr) - mapScene(p - e.yyx, tr)));
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.25;

  // Orbiting camera pushing forward through the structure.
  vec3 ro = vec3(0.0, 0.0, -3.0 + sin(t * 0.4) * 0.35);
  ro.xz = rot2(t * 0.3) * ro.xz;
  ro.y += sin(t * 0.23) * 0.7;
  vec3 fwd = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd / max(uFov, 0.25) + right * p.x + up * p.y);

  int steps = int(clamp(uQuality, 24.0, 90.0));
  float dist = 0.0;
  float trap = 1e9;
  float bestTrap = 1e9;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    if (i >= steps) break;
    vec3 pos = ro + rd * dist;
    float d = mapScene(pos, trap);
    bestTrap = min(bestTrap, trap);
    if (d < 0.0008 * dist + 0.0004) { hit = true; break; }
    dist += d * 0.9;
    if (dist > 12.0) break;
  }

  vec3 col = uColBg * 0.6;
  if (hit) {
    vec3 pos = ro + rd * dist;
    vec3 n = calcNormal(pos);
    vec3 lightDir = normalize(vec3(0.5, 0.8, -0.6));
    float diff = max(dot(n, lightDir), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    // Orbit trap tints the surface, so the fractal detail is legible.
    vec3 base = mix(uColA, uColB, clamp(bestTrap * 14.0 + 0.15, 0.0, 1.0));
    col = base * (0.18 + diff * 0.75) + uColB * rim * (0.35 + uBeat * 0.9);
    col += uColA * uBeat * 0.25;
    col = fog(col, dist, 0.13);
  } else {
    // Miss: a soft glow toward the structure so the frame never reads empty.
    col += mix(uColA, uColB, 0.5) * exp(-dot(p, p) * 3.0) * 0.10 * (0.4 + uEnv);
  }

  col *= uIntensity;
  col *= 1.0 - dot(p, p) * 0.3;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

// ------------------------------------------------------------------ lattice

/**
 * Gyroid crystal matrix: a triply-periodic minimal surface raymarched as a
 * thin shell, so it reads as an endless lattice of struts. Energy pulses
 * travel through it on beats.
 */
const LATTICE_FS = COMMON + SCENE + `
uniform float uThickness;
uniform float uCellScale;

/*
 * Infinite wireframe lattice: a box-frame SDF repeated through space, so the
 * camera flies down open corridors between glowing struts. (A gyroid was
 * tried first but its minimal surface encloses the camera — no open space.)
 */
float sdBoxFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

float mapScene(vec3 p) {
  float cell = 4.0 / max(uCellScale, 0.2);
  vec3 q = mod(p + cell * 0.5, cell) - cell * 0.5;
  return sdBoxFrame(q, vec3(cell * 0.5), uThickness + uEnv * 0.05);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy) - mapScene(p - e.xyy),
    mapScene(p + e.yxy) - mapScene(p - e.yxy),
    mapScene(p + e.yyx) - mapScene(p - e.yyx)));
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.4;

  // Fly through the lattice, yawing gently.
  vec3 ro = vec3(sin(t * 0.3) * 0.7, cos(t * 0.24) * 0.5, t * (1.2 + uRms * 1.4));
  vec3 fwd = normalize(vec3(sin(t * 0.11) * 0.18, sin(t * 0.09) * 0.12, 1.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd / max(uFov, 0.25) + right * p.x + up * p.y);

  int steps = int(clamp(uQuality, 24.0, 90.0));
  float dist = 0.1;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    if (i >= steps) break;
    float d = mapScene(ro + rd * dist);
    if (d < 0.0015 * dist + 0.0008) { hit = true; break; }
    dist += d * 0.8;
    if (dist > 30.0) break;
  }

  vec3 col = uColBg * 0.5;
  if (hit) {
    vec3 pos = ro + rd * dist;
    vec3 n = calcNormal(pos);
    float diff = max(dot(n, normalize(vec3(0.4, 0.7, -0.5))), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    col = uColA * (0.10 + diff * 0.85) + uColB * rim * 0.7;
    // Pulses of light sweep along the tunnel axis on each beat.
    float pulse = pow(0.5 + 0.5 * sin(pos.z * 1.4 - uTime * 5.0), 16.0);
    col += mix(uColA, uColB, 0.6) * pulse * (0.25 + uBeat * 1.4);
    col = fog(col, dist, 0.10);
  }
  col += mix(uColA, uColB, 0.5) * exp(-dot(p, p) * 8.0) * (0.06 + uBeat * 0.22);

  col *= uIntensity;
  col *= 1.0 - dot(p, p) * 0.28;
  outColor = vec4(grain(col, vUv), 1.0);
}`;

// ---------------------------------------------------------------- exports

const quality = { kind: 'slider', min: 24, max: 90, step: 1, def: 60 } as const;
const fov = { kind: 'slider', min: 0.3, max: 1.6, step: 0.05, def: 0.9 } as const;

export const bgHyperspace = makeShaderBg('bg-hyperspace', HYPERSPACE_FS, {
  intensity: 0.95,
  extraSchema: { quality, fov },
});

export const bgMegastructure = makeShaderBg('bg-megastruct', MEGASTRUCT_FS, {
  intensity: 0.95,
  extraSchema: {
    quality,
    fov,
    fold: { kind: 'slider', min: 0.6, max: 1.6, step: 0.01, def: 1.05 },
    iter: { kind: 'slider', min: 3, max: 10, step: 1, def: 7 },
  },
});

export const bgLattice3d = makeShaderBg('bg-lattice3d', LATTICE_FS, {
  intensity: 0.95,
  extraSchema: {
    quality,
    fov,
    thickness: { kind: 'slider', min: 0.02, max: 0.5, step: 0.01, def: 0.09 },
    cellScale: { kind: 'slider', min: 0.4, max: 3, step: 0.05, def: 1.0 },
  },
});
