/**
 * Analysis pipeline: turns decoded PCM into a deterministic FeatureTrack
 * sampled at the project frame rate. Pure TypeScript (no Web Audio at this
 * stage) so it runs identically in the browser and in Vitest/Node.
 */

import { FFT, hannWindow } from './fft';
import { BAND_COUNT, type FeatureTrack } from './types';

export const FFT_SIZE = 2048;
/** Analysis band range in Hz (upper edge clamped to 0.45 * sampleRate). */
export const BAND_MIN_HZ = 30;
export const BAND_MAX_HZ = 16000;

/** dB floor used when normalizing band magnitudes. */
const DB_FLOOR = -72;

export interface AnalysisOptions {
  fps: number;
  /** Attack smoothing coefficient for band display (0..1, higher = snappier). */
  bandAttack?: number;
  /** Release smoothing coefficient for band display. */
  bandRelease?: number;
}

/**
 * Map BAND_COUNT log-spaced bands onto FFT bin ranges.
 * Returns array of [startBin, endBin) pairs, each at least one bin wide,
 * monotonically increasing and covering min..max Hz.
 */
export function computeBandRanges(sampleRate: number, fftSize: number = FFT_SIZE): Array<[number, number]> {
  const nyquist = sampleRate / 2;
  const fMin = BAND_MIN_HZ;
  const fMax = Math.min(BAND_MAX_HZ, nyquist * 0.9);
  const binHz = sampleRate / fftSize;
  const ranges: Array<[number, number]> = [];
  let prevEnd = Math.max(1, Math.floor(fMin / binHz));
  for (let b = 0; b < BAND_COUNT; b++) {
    const fHi = fMin * Math.pow(fMax / fMin, (b + 1) / BAND_COUNT);
    let end = Math.ceil(fHi / binHz);
    if (end <= prevEnd) end = prevEnd + 1; // at least one bin per band
    end = Math.min(end, fftSize / 2);
    ranges.push([prevEnd, Math.max(end, prevEnd + 1)]);
    prevEnd = end;
  }
  return ranges;
}

/** Center frequency (Hz) of band `b` under the same log mapping. */
export function bandCenterHz(b: number, sampleRate: number): number {
  const fMax = Math.min(BAND_MAX_HZ, (sampleRate / 2) * 0.9);
  return BAND_MIN_HZ * Math.pow(fMax / BAND_MIN_HZ, (b + 0.5) / BAND_COUNT);
}

/**
 * Compute the full FeatureTrack for a mono signal.
 * Deterministic: same input + options → bit-identical output.
 */
export function computeFeatures(mono: Float32Array, sampleRate: number, opts: AnalysisOptions): FeatureTrack {
  const fps = opts.fps;
  const duration = mono.length / sampleRate;
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const hop = sampleRate / fps;

  const fft = new FFT(FFT_SIZE);
  const win = hannWindow(FFT_SIZE);
  const ranges = computeBandRanges(sampleRate, FFT_SIZE);

  const block = new Float32Array(FFT_SIZE);
  const mags = new Float32Array(FFT_SIZE / 2);
  const prevMags = new Float32Array(FFT_SIZE / 2);
  const scratchRe = new Float32Array(FFT_SIZE);
  const scratchIm = new Float32Array(FFT_SIZE);

  const bands = new Float32Array(frameCount * BAND_COUNT);
  const rawBand = new Float32Array(BAND_COUNT);
  const smooth = new Float32Array(BAND_COUNT);
  const rms = new Float32Array(frameCount);
  const env = new Float32Array(frameCount);
  const centroid = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);

  const attack = opts.bandAttack ?? 0.55;
  const release = opts.bandRelease ?? 0.22;
  const binHz = sampleRate / FFT_SIZE;

  let peakRms = 1e-6;
  let envPrev = 0;

  for (let f = 0; f < frameCount; f++) {
    const center = Math.round(f * hop);
    const start = center - FFT_SIZE / 2;

    // Windowed block centered on the frame time (zero-padded at edges).
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      const s = idx >= 0 && idx < mono.length ? mono[idx] : 0;
      block[i] = s * win[i];
      sumSq += s * s;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
    const frameRms = Math.sqrt(sumSq / FFT_SIZE);
    rms[f] = frameRms;
    if (frameRms > peakRms) peakRms = frameRms;

    // Peak envelope: instant attack, exponential release.
    envPrev = peak > envPrev ? peak : envPrev * 0.88 + peak * 0.12;
    env[f] = envPrev;

    fft.magnitudes(block, mags, scratchRe, scratchIm);

    // Spectral flux: half-wave-rectified positive magnitude change.
    let fl = 0;
    for (let k = 1; k < mags.length; k++) {
      const d = mags[k] - prevMags[k];
      if (d > 0) fl += d;
    }
    flux[f] = f === 0 ? 0 : fl;
    prevMags.set(mags);

    // Spectral centroid over the analysis range, log-frequency normalized.
    let num = 0;
    let den = 0;
    for (let k = 1; k < mags.length; k++) {
      num += mags[k] * k * binHz;
      den += mags[k];
    }
    if (den > 1e-9) {
      const hz = num / den;
      const lo = Math.log2(BAND_MIN_HZ);
      const hi = Math.log2(Math.min(BAND_MAX_HZ, sampleRate / 2));
      centroid[f] = Math.min(1, Math.max(0, (Math.log2(Math.max(hz, BAND_MIN_HZ)) - lo) / (hi - lo)));
    } else {
      centroid[f] = 0;
    }

    // Log-spaced bands → dB → 0..1, then attack/release smoothing.
    for (let b = 0; b < BAND_COUNT; b++) {
      const [s0, s1] = ranges[b];
      let m = 0;
      for (let k = s0; k < s1; k++) m += mags[k];
      m /= s1 - s0;
      const db = 20 * Math.log10(m + 1e-9);
      rawBand[b] = Math.min(1, Math.max(0, (db - DB_FLOOR) / -DB_FLOOR));
    }
    for (let b = 0; b < BAND_COUNT; b++) {
      const target = rawBand[b];
      const coef = target > smooth[b] ? attack : release;
      smooth[b] += (target - smooth[b]) * coef;
      bands[f * BAND_COUNT + b] = smooth[b];
    }
  }

  // Normalize RMS + envelope to track peaks.
  let peakEnv = 1e-6;
  for (let f = 0; f < frameCount; f++) if (env[f] > peakEnv) peakEnv = env[f];
  for (let f = 0; f < frameCount; f++) {
    rms[f] = Math.min(1, rms[f] / peakRms);
    env[f] = Math.min(1, env[f] / peakEnv);
  }

  // Normalize flux, then run onset picking + beat envelope.
  let peakFlux = 1e-6;
  for (let f = 0; f < frameCount; f++) if (flux[f] > peakFlux) peakFlux = flux[f];
  for (let f = 0; f < frameCount; f++) flux[f] /= peakFlux;

  const onsets = detectOnsets(flux, fps);
  const beat = beatEnvelope(onsets, fps);

  return { fps, frameCount, sampleRate, duration, bands, rms, env, centroid, flux, onsets, beat };
}

/**
 * Onset picking on a normalized flux curve: a frame is an onset when its flux
 * exceeds an adaptive threshold (local mean + delta) and is a local maximum.
 * A short refractory window prevents double triggers.
 */
export function detectOnsets(flux: Float32Array, fps: number): Uint8Array {
  const n = flux.length;
  const onsets = new Uint8Array(n);
  const meanWin = Math.max(2, Math.round(fps * 0.35)); // ±0.35 s context
  const refractory = Math.max(1, Math.round(fps * 0.12)); // 120 ms
  const delta = 0.06;
  const gain = 1.4;
  let lastOnset = -refractory;

  for (let f = 1; f < n - 1; f++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, f - meanWin); k <= Math.min(n - 1, f + meanWin); k++) {
      sum += flux[k];
      count++;
    }
    const threshold = (sum / count) * gain + delta;
    const isPeak = flux[f] > flux[f - 1] && flux[f] >= flux[f + 1];
    if (isPeak && flux[f] > threshold && f - lastOnset >= refractory) {
      onsets[f] = 1;
      lastOnset = f;
    }
  }
  return onsets;
}

/** Exponentially decaying pulse train from the onset frames. */
export function beatEnvelope(onsets: Uint8Array, fps: number): Float32Array {
  const beat = new Float32Array(onsets.length);
  // ~0.25 s half-life.
  const decay = Math.pow(0.5, 1 / (fps * 0.25));
  let v = 0;
  for (let f = 0; f < onsets.length; f++) {
    v *= decay;
    if (onsets[f]) v = 1;
    beat[f] = v;
  }
  return beat;
}

/**
 * Downsampled min/max waveform overview for the seek strip.
 * Returns interleaved [min0, max0, min1, max1, ...] with `buckets` pairs.
 */
export function waveformOverview(mono: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const per = mono.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s0 = Math.floor(b * per);
    const s1 = Math.min(mono.length, Math.max(s0 + 1, Math.floor((b + 1) * per)));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = s0; i < s1; i++) {
      const v = mono[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[b * 2] = mn === Infinity ? 0 : mn;
    out[b * 2 + 1] = mx === -Infinity ? 0 : mx;
  }
  return out;
}
