/**
 * Particle field (WebGL2). Particles are computed *analytically* from
 * (frame, seed): ambient drifters plus bursts spawned by onsets, with
 * damped radial motion integrated in closed form. No simulation state —
 * any frame renders identically whether reached by playing or seeking.
 */

import { beatAt, centroidAt, rmsAt } from '../types';
import { hash01, hash2 } from '../prng';
import { defineLayer, hexToRgb01, resolveColor } from './api';

const VS = `#version 300 es
layout(location=0) in vec4 aData; // x, y (clip), size (px), alpha
uniform float uPixelRatio;
out float vAlpha;
void main() {
  vAlpha = aData.w;
  gl_Position = vec4(aData.xy, 0.0, 1.0);
  gl_PointSize = max(aData.z * uPixelRatio, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float glow = exp(-r * r * 3.0) * smoothstep(1.0, 0.75, r);
  float i = glow * vAlpha;
  // Premultiplied output + ONE/ONE blending = correct additive glow.
  outColor = vec4(uColor * i, i);
}`;

const AMBIENT_COUNT = 420;
const BURST_LIFE = 1.6; // seconds
const MAX_BURST_PARTICLES = 160;

interface ParticleState {
  buffer: WebGLBuffer | null;
  vao: WebGLVertexArrayObject | null;
  data: Float32Array;
}

export const visParticles = defineLayer({
  id: 'vis-particles',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    burstColor: { kind: 'color', def: 'theme:c' },
    density: { kind: 'slider', min: 0.2, max: 1, step: 0.01, def: 0.65 },
    burstEnergy: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.7 },
    drift: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
    size: { kind: 'slider', min: 0.3, max: 2.5, step: 0.05, def: 1 },
  },
  init: (): ParticleState => ({
    buffer: null,
    vao: null,
    data: new Float32Array((AMBIENT_COUNT + MAX_BURST_PARTICLES * 24) * 4),
  }),
  render(rc, cfg, state) {
    const { glr, c2, w, h, features, frame, fps, time, theme } = rc;
    const gl = glr.gl;
    glr.resize(w, h);
    glr.clear();

    const rms = rmsAt(features, frame);
    const beat = beatAt(features, frame);
    const centroid = centroidAt(features, frame);
    const aspect = w / h;
    const px = Math.min(w, h) / 1080;

    let count = 0;
    const data = state.data;
    const push = (x: number, y: number, size: number, alpha: number) => {
      const i = count * 4;
      if (i + 3 >= data.length) return;
      data[i] = x;
      data[i + 1] = y;
      data[i + 2] = size;
      data[i + 3] = alpha;
      count++;
    };

    // --- Ambient drifting field ---
    const ambient = Math.round(AMBIENT_COUNT * cfg.density);
    const driftSpeed = cfg.drift * 0.045;
    for (let i = 0; i < ambient; i++) {
      const h1 = hash01(i * 3 + 1);
      const h2v = hash01(i * 3 + 2);
      const h3 = hash01(i * 3 + 3);
      // Wrapped linear drift + a slow sine wobble; fully time-parametric.
      const x0 = h1 * 2 - 1;
      const y0 = h2v * 2 - 1;
      const dirA = h3 * Math.PI * 2;
      const speed = driftSpeed * (0.3 + h1 * 0.7);
      let x = wrap1(x0 + Math.cos(dirA) * speed * time + Math.sin(time * 0.11 + h2v * 6.28) * 0.02);
      let y = wrap1(y0 + Math.sin(dirA) * speed * time + Math.cos(time * 0.13 + h1 * 6.28) * 0.02);
      const tw = 0.5 + 0.5 * Math.sin(time * (0.6 + h3 * 1.8) + h1 * 6.28);
      const alpha = (0.18 + tw * 0.34) * (0.5 + rms * 0.9);
      push(x, y, (3.2 + h3 * 4.4) * cfg.size * px * (1 + rms * 0.5), alpha);
    }

    // --- Onset bursts (closed-form damped radial motion) ---
    if (cfg.burstEnergy > 0) {
      // Onset/flux arrays are indexed by integer analysis frame; `frame` may
      // be fractional (fluid preview), so ages stay fractional but the scan
      // walks whole frames.
      const intFrame = Math.floor(frame);
      const lifeFrames = Math.round(BURST_LIFE * fps);
      const from = Math.max(0, intFrame - lifeFrames);
      const damp = 2.1; // 1/s
      for (let f0 = from; f0 <= intFrame; f0++) {
        if (!features.onsets[f0]) continue;
        const age = (frame - f0) / fps;
        const lifeT = age / BURST_LIFE;
        if (lifeT >= 1) continue;
        const strength = features.flux[f0];
        const m = Math.round((30 + strength * 110) * cfg.burstEnergy);
        // Burst origin wanders per-onset around the center.
        const ox = (hash01(f0 * 7 + 5) * 2 - 1) * 0.45;
        const oy = (hash01(f0 * 7 + 11) * 2 - 1) * 0.4;
        const fade = (1 - lifeT) * (1 - lifeT);
        for (let j = 0; j < Math.min(m, MAX_BURST_PARTICLES); j++) {
          const hj = hash2(f0, j);
          const a = (hj % 4096) / 4096 * Math.PI * 2;
          const sp = 0.25 + (((hj >>> 12) % 1024) / 1024) * 0.9 * (0.5 + strength);
          // x(t) = x0 + v0 * (1 - e^{-k t}) / k  — damped coast-out.
          const dist = (sp * (1 - Math.exp(-damp * age))) / damp;
          const x = ox + (Math.cos(a) * dist) / aspect;
          const y = oy + Math.sin(a) * dist + age * age * 0.05; // slight gravity
          const size = (2.4 + (((hj >>> 22) % 512) / 512) * 4) * cfg.size * px * (1 + fade);
          push(x, y, size, fade * 0.95);
        }
      }
    }

    // --- Upload + draw ---
    const prog = glr.getProgram('particles', FS, VS);
    if (!state.vao) {
      state.vao = gl.createVertexArray();
      state.buffer = gl.createBuffer();
      gl.bindVertexArray(state.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 4));

    gl.useProgram(prog.program);
    const mix = 0.5 + centroid * 0.5;
    const colA = hexToRgb01(resolveColor(cfg.color, theme));
    const colB = hexToRgb01(resolveColor(cfg.burstColor, theme));
    glr.setUniforms(prog, {
      uColor: [
        colA[0] * (1 - beat) + colB[0] * beat,
        colA[1] * (1 - beat) + colB[1] * beat,
        colA[2] * (1 - beat) + colB[2] * beat,
      ],
      uPixelRatio: mix * 0.4 + 0.8,
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(state.vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    glr.blit(c2);
  },
  dispose(state) {
    // GL resources die with the context; nothing retained beyond it.
    state.vao = null;
    state.buffer = null;
  },
});

function wrap1(v: number): number {
  // Wrap into [-1.1, 1.1] so particles slide off one edge and return on the other.
  const range = 2.2;
  return ((((v + 1.1) % range) + range) % range) - 1.1;
}
