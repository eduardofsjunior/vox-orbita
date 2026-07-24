/**
 * Minimal iterative radix-2 FFT, real-input convenience wrapper.
 * Pure TypeScript so the analysis pipeline is testable in Node (Vitest)
 * and byte-deterministic across preview/export.
 */

export class FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 2) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cos[i] = Math.cos(angle);
      this.sin[i] = Math.sin(angle);
    }
  }

  /** In-place complex FFT over interleaved-free re[]/im[] arrays. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tIdx = k * step;
          const wr = this.cos[tIdx];
          const wi = this.sin[tIdx];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  /**
   * Magnitude spectrum of a real input block (length = size).
   * Writes size/2 magnitudes into `out` (DC..Nyquist-1), normalized by size/2.
   */
  magnitudes(input: Float32Array, out: Float32Array, scratchRe: Float32Array, scratchIm: Float32Array): void {
    const n = this.size;
    scratchRe.set(input);
    scratchIm.fill(0);
    this.transform(scratchRe, scratchIm);
    const norm = 2 / n;
    for (let i = 0; i < n / 2; i++) {
      out[i] = Math.hypot(scratchRe[i], scratchIm[i]) * norm;
    }
  }
}

/** Periodic Hann window, precomputed. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  return w;
}
