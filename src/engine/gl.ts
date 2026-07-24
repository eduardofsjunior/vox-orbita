/**
 * Small WebGL2 helper. One shared GL canvas per compositor; GL layers render
 * into it (transparent background) and blit the result into the 2D output.
 *
 * `preserveDrawingBuffer` is enabled so the blit is guaranteed to read the
 * freshly rendered frame regardless of compositing timing.
 */

export interface GLProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class GLRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, GLProgram>();
  private quadVao: WebGLVertexArrayObject;

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas ?? new OffscreenCanvas(16, 16);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.quadVao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Resize the GL canvas (and viewport) if needed. */
  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /** Compile (and cache) a program. `key` must be unique per shader pair. */
  getProgram(key: string, fragSrc: string, vertSrc: string = QUAD_VS): GLProgram {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('createShader failed');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader compile error in "${key}": ${log}`);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error in "${key}": ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(program, info.name);
      if (loc) uniforms.set(info.name.replace('[0]', ''), loc);
    }
    const entry = { program, uniforms };
    this.programs.set(key, entry);
    return entry;
  }

  /** Clear the GL canvas to transparent (color + depth). */
  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Run a full-screen fragment shader. Uniforms are set from the map
   * (numbers, [x,y], [x,y,z], [x,y,z,w] or Float32Array for float arrays).
   */
  drawQuad(prog: GLProgram, uniforms: Record<string, number | number[] | Float32Array>): void {
    const gl = this.gl;
    gl.useProgram(prog.program);
    this.setUniforms(prog, uniforms);
    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  setUniforms(prog: GLProgram, uniforms: Record<string, number | number[] | Float32Array>): void {
    const gl = this.gl;
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = prog.uniforms.get(name);
      if (!loc) continue;
      if (typeof value === 'number') gl.uniform1f(loc, value);
      // Convention: a 16-float Float32Array is a column-major mat4.
      else if (value instanceof Float32Array && value.length === 16) gl.uniformMatrix4fv(loc, false, value);
      else if (value instanceof Float32Array) gl.uniform1fv(loc, value);
      else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
    }
  }

  /** Draw the GL canvas onto a 2D context. */
  blit(c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
    c2.drawImage(this.canvas as CanvasImageSource, 0, 0);
  }

  isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  dispose(): void {
    for (const { program } of this.programs.values()) this.gl.deleteProgram(program);
    this.programs.clear();
    // Actually release the context (browsers cap concurrent WebGL contexts).
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
