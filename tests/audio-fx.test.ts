import { describe, expect, it } from 'vitest';
import {
  defaultEffects,
  effectsFromPreset,
  EFFECTS,
  FX_PRESETS,
  hasActiveEffects,
  processChain,
  type EffectState,
} from '../src/engine/audio-fx';
import { sine } from '../src/engine/testsignal';

const SR = 44100;

/** Build a chain with one effect enabled and given config overrides. */
function chainWith(id: string, config: Record<string, unknown>): EffectState[] {
  return defaultEffects().map((s) =>
    s.id === id ? { ...s, enabled: true, config: { ...s.config, ...config } } : s,
  );
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

/** Dominant frequency via zero-crossing rate (good enough for pure tones). */
function estimateFreq(x: Float32Array, sr: number): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return (crossings * sr) / x.length;
}

describe('effects chain plumbing', () => {
  it('is identity when no effect is enabled', () => {
    const src = [sine(440, 0.5, SR, 0.5)];
    const out = processChain(src, SR, defaultEffects());
    expect(out).toHaveLength(1);
    expect(Array.from(out[0])).toEqual(Array.from(src[0]));
  });

  it('never mutates the source channels', () => {
    const src = [sine(440, 0.3, SR, 0.5)];
    const before = Array.from(src[0]);
    processChain(src, SR, chainWith('fx-distortion', { drive: 20, mix: 1 }));
    expect(Array.from(src[0])).toEqual(before);
  });

  it('preserves channel count and length', () => {
    const src = [sine(300, 0.4, SR, 0.4), sine(300, 0.4, SR, 0.4)];
    const out = processChain(src, SR, chainWith('fx-reverb', { size: 0.6, damp: 0.4, mix: 0.4 }));
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(src[0].length);
  });

  it('hasActiveEffects reflects enable flags', () => {
    expect(hasActiveEffects(defaultEffects())).toBe(false);
    expect(hasActiveEffects(chainWith('fx-eq', { low: 3 }))).toBe(true);
  });
});

describe('filter', () => {
  it('high-pass attenuates a low tone', () => {
    const low = [sine(60, 0.5, SR, 0.5)];
    const out = processChain(low, SR, chainWith('fx-filter', { highpass: 400, lowpass: 20000 }));
    expect(rms(out[0])).toBeLessThan(rms(low[0]) * 0.5);
  });

  it('low-pass attenuates a high tone', () => {
    const high = [sine(8000, 0.5, SR, 0.5)];
    const out = processChain(high, SR, chainWith('fx-filter', { highpass: 20, lowpass: 1500 }));
    expect(rms(out[0])).toBeLessThan(rms(high[0]) * 0.5);
  });

  it('passes a mid tone roughly unchanged', () => {
    const mid = [sine(1000, 0.5, SR, 0.5)];
    const out = processChain(mid, SR, chainWith('fx-filter', { highpass: 100, lowpass: 8000 }));
    expect(rms(out[0])).toBeGreaterThan(rms(mid[0]) * 0.8);
  });
});

describe('EQ', () => {
  it('low shelf boost raises a bass tone', () => {
    const bass = [sine(80, 0.5, SR, 0.4)];
    const out = processChain(bass, SR, chainWith('fx-eq', { low: 12, mid: 0, high: 0, midFreq: 1000 }));
    expect(rms(out[0])).toBeGreaterThan(rms(bass[0]) * 1.5);
  });

  it('flat EQ is near-transparent', () => {
    const tone = [sine(1000, 0.5, SR, 0.4)];
    const out = processChain(tone, SR, chainWith('fx-eq', { low: 0, mid: 0, high: 0, midFreq: 1000 }));
    expect(rms(out[0])).toBeCloseTo(rms(tone[0]), 1);
  });
});

describe('dynamics', () => {
  it('compressor reduces the level of a loud signal', () => {
    const loud = [sine(500, 0.5, SR, 0.9)];
    const out = processChain(loud, SR, chainWith('fx-comp', { threshold: -24, ratio: 8, attack: 2, release: 60, makeup: 0 }));
    expect(rms(out[0])).toBeLessThan(rms(loud[0]));
  });

  it('gate silences a quiet signal below threshold', () => {
    const quiet = [sine(500, 0.5, SR, 0.02)];
    const out = processChain(quiet, SR, chainWith('fx-gate', { threshold: -30, reduction: 1, attack: 5, release: 50 }));
    expect(rms(out[0])).toBeLessThan(rms(quiet[0]) * 0.2);
  });
});

describe('voice / creative', () => {
  it('pitch shift keeps length and raises frequency for +12 semitones', () => {
    const tone = sine(300, 1, SR, 0.5);
    const out = processChain([tone], SR, chainWith('fx-pitch', { semitones: 12 }));
    expect(out[0].length).toBe(tone.length);
    const f0 = estimateFreq(tone, SR);
    const f1 = estimateFreq(out[0], SR);
    // +12 semitones ≈ ×2. Granular shifting is approximate; allow a wide band.
    expect(f1).toBeGreaterThan(f0 * 1.6);
    expect(f1).toBeLessThan(f0 * 2.5);
  });

  it('pitch shift of 0 semitones is a pass-through', () => {
    const tone = sine(300, 0.3, SR, 0.5);
    const out = processChain([tone], SR, chainWith('fx-pitch', { semitones: 0 }));
    expect(Array.from(out[0])).toEqual(Array.from(tone));
  });

  it('bitcrush quantizes to a small set of levels', () => {
    const tone = [sine(440, 0.2, SR, 0.8)];
    const out = processChain(tone, SR, chainWith('fx-bitcrush', { bits: 2, downsample: 1, mix: 1 }));
    const levels = new Set(Array.from(out[0]).map((v) => Math.round(v * 1000)));
    expect(levels.size).toBeLessThanOrEqual(6); // 2-bit ⇒ ~4 levels
  });

  it('distortion keeps the signal bounded', () => {
    const tone = [sine(440, 0.2, SR, 0.9)];
    const out = processChain(tone, SR, chainWith('fx-distortion', { drive: 40, mix: 1 }));
    for (const v of out[0]) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
  });
});

describe('output', () => {
  it('normalize brings the peak close to full scale', () => {
    const soft = [sine(440, 0.3, SR, 0.1)];
    const out = processChain(soft, SR, chainWith('fx-output', { gain: 0, normalize: true }));
    let peak = 0;
    for (const v of out[0]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.85);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('gain scales the signal', () => {
    const tone = [sine(440, 0.3, SR, 0.3)];
    const out = processChain(tone, SR, chainWith('fx-output', { gain: 6, normalize: false }));
    expect(rms(out[0])).toBeGreaterThan(rms(tone[0]) * 1.7); // +6 dB ≈ ×2
  });
});

describe('presets', () => {
  it('every preset enables at least one effect and processes cleanly', () => {
    const src = [sine(220, 0.5, SR, 0.4), sine(220, 0.5, SR, 0.4)];
    for (const p of FX_PRESETS) {
      const states = effectsFromPreset(p);
      expect(hasActiveEffects(states)).toBe(true);
      const out = processChain(src, SR, states);
      expect(out[0].length).toBe(src[0].length);
      for (const v of out[0]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('effectsFromPreset aligns to the registry and disables unlisted effects', () => {
    const states = effectsFromPreset(FX_PRESETS[0]);
    expect(states).toHaveLength(EFFECTS.length);
    const pitch = states.find((s) => s.id === 'fx-pitch')!;
    expect(pitch.enabled).toBe(false); // podcast-clean doesn't use pitch
  });

  it('is deterministic (same input + chain → identical output)', () => {
    const src = [sine(330, 0.4, SR, 0.5)];
    const states = effectsFromPreset(FX_PRESETS.find((p) => p.id === 'robot')!);
    const a = processChain(src, SR, states);
    const b = processChain(src, SR, states);
    expect(Array.from(a[0])).toEqual(Array.from(b[0]));
  });
});
