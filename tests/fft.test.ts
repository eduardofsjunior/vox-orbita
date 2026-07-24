import { describe, expect, it } from 'vitest';
import { FFT, hannWindow } from '../src/engine/fft';

describe('FFT', () => {
  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow();
  });

  it('finds a pure sine at the exact bin', () => {
    const size = 2048;
    const sampleRate = 48000;
    const bin = 128;
    const freq = (bin * sampleRate) / size;
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);

    const fft = new FFT(size);
    const mags = new Float32Array(size / 2);
    fft.magnitudes(input, mags, new Float32Array(size), new Float32Array(size));

    let peakBin = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peakBin]) peakBin = i;
    expect(peakBin).toBe(bin);
    // Full-scale sine → magnitude ≈ 1 with the 2/N normalization.
    expect(mags[peakBin]).toBeGreaterThan(0.95);
    expect(mags[peakBin]).toBeLessThan(1.05);
  });

  it('windowed DC block has no high-frequency leakage', () => {
    const size = 1024;
    const win = hannWindow(size);
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = win[i]; // windowed constant 1
    const fft = new FFT(size);
    const mags = new Float32Array(size / 2);
    fft.magnitudes(input, mags, new Float32Array(size), new Float32Array(size));
    // Energy concentrated in bins 0..2; far bins negligible.
    expect(mags[0]).toBeGreaterThan(0.5);
    expect(mags[100]).toBeLessThan(1e-3);
  });
});
