/**
 * Spectrum wheel (3D): 64 bars extruded into boxes around a rotating ring,
 * rendered with a perspective camera and simple lambert shading.
 *
 * Geometry is rebuilt on the CPU every frame from the FeatureTrack (2304
 * vertices — trivial), so the layer stays a pure function of the frame.
 */

import { bandsAt, beatAt, rmsAt } from '../types';
import { multiply, perspective, rotationX, rotationY, translation } from '../mat4';
import { defineLayer, hexToRgb01, resolveColor } from './api';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aVal;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vNormal;
out float vVal;
out float vY;
void main() {
  vNormal = mat3(uModel) * aNormal;
  vVal = aVal;
  vY = aPos.y;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uBeat;
in vec3 vNormal;
in float vVal;
in float vY;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(0.35, 0.85, 0.45));
  float diff = max(dot(n, light), 0.0);
  float ambient = 0.34;
  vec3 base = mix(uColA, uColB, clamp(vVal * 0.8 + vY * 0.35, 0.0, 1.0));
  vec3 col = base * (ambient + diff * 0.75);
  // Hot emissive tips + a subtle full-ring flash on beats.
  col += base * smoothstep(0.5, 1.0, vVal) * 0.55;
  col += uColB * uBeat * 0.12;
  outColor = vec4(col, 1.0);
}`;

const BANDS = 64;
const FLOATS_PER_VERT = 7; // pos3 + normal3 + val
const VERTS_PER_BOX = 36;

interface Wheel3dState {
  vao: WebGLVertexArrayObject | null;
  buffer: WebGLBuffer | null;
  data: Float32Array;
}

export const visWheel3d = defineLayer({
  id: 'vis-wheel3d',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    tipColor: { kind: 'color', def: 'theme:b' },
    radius: { kind: 'slider', min: 0.8, max: 2.2, step: 0.05, def: 1.45 },
    height: { kind: 'slider', min: 0.2, max: 2, step: 0.05, def: 1.05 },
    thickness: { kind: 'slider', min: 0.3, max: 1, step: 0.01, def: 0.62 },
    rotateSpeed: { kind: 'slider', min: -60, max: 60, step: 1, def: 14, unit: '°/s' },
    tilt: { kind: 'slider', min: 0, max: 60, step: 1, def: 26, unit: '°' },
    beatKick: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
    mirror: { kind: 'toggle', def: true },
  },
  init: (): Wheel3dState => ({
    vao: null,
    buffer: null,
    data: new Float32Array(BANDS * VERTS_PER_BOX * FLOATS_PER_VERT),
  }),
  render(rc, cfg, state) {
    const { glr, c2, w, h, features, frame, time, theme } = rc;
    const gl = glr.gl;
    glr.resize(w, h);
    glr.clear();

    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);
    const rms = rmsAt(features, frame);
    const kick = cfg.beatKick * beat;

    // --- Build the ring of boxes ---
    const R = cfg.radius;
    const maxH = cfg.height * (1 + kick * 0.3);
    const slotAngle = (Math.PI * 2) / BANDS;
    const halfW = R * Math.sin(slotAngle / 2) * cfg.thickness; // tangent half-width
    const halfD = halfW; // square footprint
    let o = 0;
    const d = state.data;

    for (let i = 0; i < BANDS; i++) {
      // Mirrored mode folds the spectrum so bass peaks face each other and
      // the wheel stays visually balanced while rotating.
      const band = cfg.mirror ? (i < 32 ? i * 2 : (BANDS - 1 - i) * 2 + 1) : i;
      const v = bands[band];
      const bh = Math.max(0.035, Math.pow(v, 1.5) * maxH);
      const a = i * slotAngle;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Local frame: radial (r̂), tangent (t̂), up (ŷ). Box centered on the
      // ring at y ∈ [0, bh].
      const cx = cos * R;
      const cz = sin * R;
      // 8 corners in (t, y, r) offsets, then map into world space.
      o = emitBox(d, o, cx, cz, cos, sin, halfW, halfD, bh, v);
    }

    // --- Camera ---
    const aspect = w / h;
    const proj = perspective((42 * Math.PI) / 180, aspect, 0.1, 100);
    const dist = 4.6 - rms * 0.15; // gentle push-in on loud passages
    const view = multiply(translation(0, -0.28, -dist), rotationX((cfg.tilt * Math.PI) / 180));
    const model = rotationY((cfg.rotateSpeed * time * Math.PI) / 180);
    const mvp = multiply(multiply(proj, view), model);

    // --- Upload + draw ---
    const prog = glr.getProgram('wheel3d', FS, VS);
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
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);

    gl.useProgram(prog.program);
    glr.setUniforms(prog, {
      uMVP: mvp,
      uModel: model,
      uColA: hexToRgb01(resolveColor(cfg.color, theme)),
      uColB: hexToRgb01(resolveColor(cfg.tipColor, theme)),
      uBeat: beat,
    });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(state.vao);
    gl.drawArrays(gl.TRIANGLES, 0, BANDS * VERTS_PER_BOX);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    glr.blit(c2);
  },
  dispose(state) {
    state.vao = null;
    state.buffer = null;
  },
});

/**
 * Emit one box (36 verts) whose local axes are tangent (t̂), up (ŷ) and
 * radial (r̂) at ring angle with cos/sin. Returns the new write offset.
 */
function emitBox(
  d: Float32Array,
  o: number,
  cx: number,
  cz: number,
  cos: number,
  sin: number,
  halfW: number,
  halfD: number,
  height: number,
  val: number,
): number {
  // Tangent direction t̂ = (-sin, 0, cos); radial r̂ = (cos, 0, sin).
  const tx = -sin;
  const tz = cos;

  const corner = (t: number, y: number, r: number): [number, number, number] => [
    cx + tx * t * halfW + cos * r * halfD,
    y,
    cz + tz * t * halfW + sin * r * halfD,
  ];

  // Faces as (normal, 4 corners CCW seen from outside).
  const faces: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = [
    { n: [cos, 0, sin], c: [corner(-1, 0, 1), corner(1, 0, 1), corner(1, height, 1), corner(-1, height, 1)] }, // outer
    { n: [-cos, 0, -sin], c: [corner(1, 0, -1), corner(-1, 0, -1), corner(-1, height, -1), corner(1, height, -1)] }, // inner
    { n: [tx, 0, tz], c: [corner(1, 0, 1), corner(1, 0, -1), corner(1, height, -1), corner(1, height, 1)] }, // side +t
    { n: [-tx, 0, -tz], c: [corner(-1, 0, -1), corner(-1, 0, 1), corner(-1, height, 1), corner(-1, height, -1)] }, // side −t
    { n: [0, 1, 0], c: [corner(-1, height, 1), corner(1, height, 1), corner(1, height, -1), corner(-1, height, -1)] }, // top
    { n: [0, -1, 0], c: [corner(-1, 0, -1), corner(1, 0, -1), corner(1, 0, 1), corner(-1, 0, 1)] }, // bottom
  ];

  for (const { n, c } of faces) {
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const p = c[idx];
      d[o++] = p[0];
      d[o++] = p[1];
      d[o++] = p[2];
      d[o++] = n[0];
      d[o++] = n[1];
      d[o++] = n[2];
      d[o++] = val;
    }
  }
  return o;
}
