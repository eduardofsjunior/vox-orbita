import { describe, expect, it } from 'vitest';
import { bandCenterHz, computeBandRanges, computeFeatures, FFT_SIZE } from '../src/engine/features';
import { BAND_COUNT, bandsAt } from '../src/engine/types';
import { sine } from '../src/engine/testsignal';

describe('band mapping', () => {
  it('produces BAND_COUNT monotonic, non-empty bin ranges', () => {
    for (const sr of [22050, 44100, 48000]) {
      const ranges = computeBandRanges(sr);
      expect(ranges).toHaveLength(BAND_COUNT);
      let prevEnd = 0;
      for (const [start, end] of ranges) {
        expect(end).toBeGreaterThan(start); // at least one bin
        expect(start).toBeGreaterThanOrEqual(prevEnd);
        expect(end).toBeLessThanOrEqual(FFT_SIZE / 2);
        prevEnd = end;
      }
    }
  });

  it('band centers grow log-spaced', () => {
    const c0 = bandCenterHz(0, 48000);
    const c31 = bandCenterHz(31, 48000);
    const c63 = bandCenterHz(63, 48000);
    expect(c0).toBeLessThan(c31);
    expect(c31).toBeLessThan(c63);
    // Log spacing: equal index steps ≈ equal frequency ratios.
    const r1 = c31 / c0;
    const r2 = c63 / c31;
    expect(Math.abs(Math.log(r1) - Math.log(r2))).toBeLessThan(0.15);
  });

  it('a sine excites the band containing its frequency', () => {
    const sr = 48000;
    const freq = 1000;
    const track = computeFeatures(sine(freq, 1, sr, 0.8), sr, { fps: 30 });
    const bands = bandsAt(track, 15); // mid-file frame
    let peakBand = 0;
    for (let b = 1; b < BAND_COUNT; b++) if (bands[b] > bands[peakBand]) peakBand = b;
    const center = bandCenterHz(peakBand, sr);
    // Peak band's center frequency within half an octave of the sine.
    expect(Math.abs(Math.log2(center / freq))).toBeLessThan(0.5);
  });
});
