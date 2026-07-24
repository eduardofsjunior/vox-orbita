/**
 * Pulse sphere (3D): a rotating wireframe sphere whose surface is displaced
 * radially by the spectrum — bass swells the equator, highs ripple the
 * poles. Additive "hologram" shading with view-depth fade for the 3D cue.
 */

import { bandsAt, beatAt, centroidAt } from '../types';
import { multiply, perspective, rotationX, rotationY, rotationZ, translation } from '../mat4';
import { defineLayer, hexToRgb01, resolveColor } from './api';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aVal;
uniform mat4 uMVP;
out float vVal;
out float vZ;
void main() {
  vVal = aVal;
  vec4 p = uMVP * vec4(aPos, 1.0);
  vZ = p.z / max(p.w, 0.0001);
  gl_Position = p;
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uAlpha;
in float vVal;
in float vZ;
out vec4 outColor;
void main() {
  // Depth cue: nearer lines brighter (clip z in [-1, 1], -1 = near).
  float depthFade = mix(1.0, 0.28, clamp(vZ * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = mix(uColA, uColB, clamp(vVal * 1.2, 0.0, 1.0));
  float i = uAlpha * depthFade * (0.5 + vVal * 0.9);
  outColor = vec4(col * i, i); // premultiplied, additive ONE/ONE
}`;

const LAT_RINGS = 26;
const LON_SEGS = 52;
const FLOATS_PER_VERT = 4; // pos3 + val

interface Sphere3dState {
  vao: WebGLVertexArrayObject | null;
  buffer: WebGLBuffer | null;
  data: Float32Array;
  vertCount: number;
}

export const visSphere3d = defineLayer({
  id: 'vis-sphere3d',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    tipColor: { kind: 'color', def: 'theme:c' },
    size: { kind: 'slider', min: 0.5, max: 1.6, step: 0.05, def: 1 },
    amplitude: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
    rotateSpeed: { kind: 'slider', min: -60, max: 60, step: 1, def: 12, unit: '°/s' },
    tilt: { kind: 'slider', min: 0, max: 60, step: 1, def: 22, unit: '°' },
    beatPulse: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
    glow: { kind: 'slider', min: 0.2, max: 1, step: 0.01, def: 0.7 },
  },
  init: (): Sphere3dState => {
    // Segment count: latitude circles + longitude arcs, 2 verts per segment.
    const latSegs = (LAT_RINGS - 1) * LON_SEGS;
    const lonSegs = LON_SEGS * (LAT_RINGS - 1);
    const vertCount = (latSegs + lonSegs) * 2;
    return { vao: null, buffer: null, data: new Float32Array(vertCount * FLOATS_PER_VERT), vertCount };
  },
  render(rc, cfg, state) {
    const { glr, c2, w, h, features, frame, time, theme } = rc;
    const gl = glr.gl;
    glr.resize(w, h);
    glr.clear();

    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);
    const centroid = centroidAt(features, frame);
    const baseR = cfg.size * (1 + beat * cfg.beatPulse * 0.12);

    // Displaced radius at a grid point. Equator (lat 0.5) = bass, poles =
    // highs; a slow longitudinal ripple keeps the surface organic.
    const radiusAt = (latN: number, lonN: number): { r: number; v: number } => {
      const band = Math.min(63, Math.floor(Math.abs(latN * 2 - 1) * 63.999));
      const v = bands[band];
      const ripple = 0.88 + 0.12 * Math.sin(lonN * Math.PI * 6 + time * 1.3 + latN * 4);
      return { r: baseR * (1 + Math.pow(v, 1.3) * cfg.amplitude * 0.55 * ripple), v };
    };

    const point = (latN: number, lonN: number): [number, number, number, number] => {
      const { r, v } = radiusAt(latN, lonN);
      const phi = latN * Math.PI; // 0..π from pole to pole
      const theta = lonN * Math.PI * 2;
      const sp = Math.sin(phi);
      return [r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta), v];
    };

    // --- Build wireframe segments ---
    const d = state.data;
    let o = 0;
    const push = (p: [number, number, number, number]) => {
      d[o++] = p[0];
      d[o++] = p[1];
      d[o++] = p[2];
      d[o++] = p[3];
    };
    // Latitude circles (skip the poles).
    for (let la = 1; la < LAT_RINGS; la++) {
      const latN = la / LAT_RINGS;
      for (let lo = 0; lo < LON_SEGS; lo++) {
        push(point(latN, lo / LON_SEGS));
        push(point(latN, (lo + 1) / LON_SEGS));
      }
    }
    // Longitude arcs.
    for (let lo = 0; lo < LON_SEGS; lo++) {
      const lonN = lo / LON_SEGS;
      for (let la = 1; la < LAT_RINGS; la++) {
        push(point((la - 0) / LAT_RINGS, lonN));
        push(point((la + 1) / LAT_RINGS > 1 ? 1 : (la + 1) / LAT_RINGS, lonN));
      }
    }
    const vertCount = o / FLOATS_PER_VERT;

    // --- Camera ---
    const proj = perspective((40 * Math.PI) / 180, w / h, 0.1, 100);
    const view = multiply(translation(0, 0, -4.1), rotationX((cfg.tilt * Math.PI) / 180));
    const spin = (cfg.rotateSpeed * time * Math.PI) / 180;
    // Slight z-wobble driven by the spectral centroid for extra life.
    const model = multiply(rotationY(spin), rotationZ(Math.sin(time * 0.4) * 0.08 + centroid * 0.05));
    const mvp = multiply(multiply(proj, view), model);

    // --- Upload + draw ---
    const prog = glr.getProgram('sphere3d', FS, VS);
    if (!state.vao) {
      state.vao = gl.createVertexArray();
      state.buffer = gl.createBuffer();
      gl.bindVertexArray(state.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, d.byteLength, gl.DYNAMIC_DRAW);
      const stride = FLOATS_PER_VERT * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, o));

    gl.useProgram(prog.program);
    glr.setUniforms(prog, {
      uMVP: mvp,
      uColA: hexToRgb01(resolveColor(cfg.color, theme)),
      uColB: hexToRgb01(resolveColor(cfg.tipColor, theme)),
      uAlpha: cfg.glow * 0.75,
    });
    // Additive hologram: no depth test (lines glow through), ONE/ONE blend.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(state.vao);
    gl.drawArrays(gl.LINES, 0, Math.min(vertCount, state.vertCount));
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    glr.blit(c2);
  },
  dispose(state) {
    state.vao = null;
    state.buffer = null;
  },
});
