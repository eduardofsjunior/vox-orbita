import { describe, expect, it } from 'vitest';
import { beatEnvelope, computeFeatures, detectOnsets, waveformOverview } from '../src/engine/features';
import { bandsAt, rmsAt, smoothedAt, BAND_COUNT } from '../src/engine/types';
import { clickTrack, demoGroove, sine } from '../src/engine/testsignal';

describe('feature track', () => {
  it('has frame-rate-consistent dimensions', () => {
    const sr = 44100;
    const track = computeFeatures(sine(440, 2.5, sr), sr, { fps: 30 });
    expect(track.frameCount).toBe(Math.ceil(2.5 * 30));
    expect(track.bands.length).toBe(track.frameCount * 64);
    expect(track.rms.length).toBe(track.frameCount);
    expect(track.duration).toBeCloseTo(2.5, 5);
  });

  it('is deterministic (bit-identical across runs)', () => {
    const sr = 44100;
    const input = demoGroove(sr, 3).mono;
    const a = computeFeatures(input, sr, { fps: 30 });
    const b = computeFeatures(input, sr, { fps: 30 });
    expect(a.bands).toEqual(b.bands);
    expect(a.flux).toEqual(b.flux);
    expect(a.onsets).toEqual(b.onsets);
  });

  it('normalizes rms and env into 0..1', () => {
    const sr = 44100;
    const track = computeFeatures(demoGroove(sr, 3).mono, sr, { fps: 30 });
    for (let f = 0; f < track.frameCount; f++) {
      expect(track.rms[f]).toBeGreaterThanOrEqual(0);
      expect(track.rms[f]).toBeLessThanOrEqual(1);
      expect(track.env[f]).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...track.rms)).toBeCloseTo(1, 5);
  });
});

describe('fractional-frame sampling', () => {
  const sr = 44100;
  const track = computeFeatures(demoGroove(sr, 3).mono, sr, { fps: 30 });

  it('integer frames return exact pre-computed values (export path)', () => {
    const view = bandsAt(track, 20);
    for (let b = 0; b < BAND_COUNT; b++) {
      expect(view[b]).toBe(track.bands[20 * BAND_COUNT + b]);
    }
    expect(rmsAt(track, 20)).toBe(track.rms[20]);
  });

  it('fractional frames interpolate linearly between neighbors', () => {
    const mid = bandsAt(track, 20.5);
    for (let b = 0; b < BAND_COUNT; b++) {
      const expected = (track.bands[20 * BAND_COUNT + b] + track.bands[21 * BAND_COUNT + b]) / 2;
      expect(mid[b]).toBeCloseTo(expected, 5);
    }
    expect(rmsAt(track, 20.25)).toBeCloseTo(track.rms[20] * 0.75 + track.rms[21] * 0.25, 6);
  });

  it('clamps out-of-range frames', () => {
    expect(rmsAt(track, -5)).toBe(track.rms[0]);
    expect(rmsAt(track, 10_000)).toBe(track.rms[track.frameCount - 1]);
  });

  it('smoothedAt is a trailing box average', () => {
    const arr = new Float32Array([0, 1, 2, 3, 4, 5]);
    expect(smoothedAt(arr, 6, 4, 3)).toBeCloseTo((2 + 3 + 4) / 3, 6);
    // Window clamped at the start of the track.
    expect(smoothedAt(arr, 6, 1, 10)).toBeCloseTo((0 + 1) / 2, 6);
    // windowFrames <= 1 falls back to instantaneous (interpolated) sampling.
    expect(smoothedAt(arr, 6, 2.5, 1)).toBeCloseTo(2.5, 6);
    expect(smoothedAt(arr, 6, 3, 0)).toBe(3);
  });
});

describe('onset detection', () => {
  it('finds every click of a synthetic click track within ±1 frame', () => {
    const sr = 44100;
    const fps = 30;
    const interval = 0.5;
    const duration = 6;
    const track = computeFeatures(clickTrack(duration, interval, sr), sr, { fps });

    const detected: number[] = [];
    for (let f = 0; f < track.frameCount; f++) if (track.onsets[f]) detected.push(f);

    const expected: number[] = [];
    for (let t = interval; t < duration - 0.05; t += interval) expected.push(Math.round(t * fps));

    expect(detected.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(detected[i] - expected[i])).toBeLessThanOrEqual(1);
    }
  });

  it('reports no onsets on a steady sine', () => {
    const sr = 44100;
    const track = computeFeatures(sine(440, 3, sr), sr, { fps: 30 });
    // Ignore the attack at frame 0..2 (signal starts from silence).
    const count = track.onsets.slice(4).reduce((a, b) => a + b, 0);
    expect(count).toBe(0);
  });

  it('beat envelope decays exponentially after an onset', () => {
    const onsets = new Uint8Array(90);
    onsets[10] = 1;
    const beat = beatEnvelope(onsets, 30);
    expect(beat[10]).toBe(1);
    expect(beat[20]).toBeLessThan(beat[10]);
    expect(beat[20]).toBeGreaterThan(0);
    // Half-life ≈ 0.25 s = 7.5 frames.
    expect(beat[17]).toBeGreaterThan(0.4);
    expect(beat[18]).toBeLessThan(0.6);
  });

  it('detectOnsets respects the refractory period', () => {
    const flux = new Float32Array(60);
    flux[10] = 1;
    flux[11] = 0.9;
    flux[12] = 1;
    const onsets = detectOnsets(flux, 30);
    const total = onsets.reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });
});

describe('waveform overview', () => {
  it('captures min/max per bucket', () => {
    const data = new Float32Array([0, 0.5, -0.5, 0, 1, -1, 0, 0]);
    const ov = waveformOverview(data, 2);
    expect(ov[0]).toBe(-0.5);
    expect(ov[1]).toBe(0.5);
    expect(ov[2]).toBe(-1);
    expect(ov[3]).toBe(1);
  });
});
