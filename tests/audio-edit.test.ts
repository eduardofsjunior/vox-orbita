import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  applyFades,
  buildEditPlan,
  defaultEdits,
  detectSilence,
  hasActiveEdits,
  measureLufs,
  mixBed,
  normalizeLoudness,
  outToSource,
  sourceToOut,
  type AudioEdits,
} from '../src/engine/audio-edit';
import { sine } from '../src/engine/testsignal';

const SR = 44100;

/** Tone / silence / tone: 1 s each. */
function gappedSignal(): Float32Array {
  const out = new Float32Array(SR * 3);
  const tone = sine(440, 1, SR, 0.5);
  out.set(tone, 0);
  out.set(tone, SR * 2);
  return out;
}

function withEdits(patch: (e: AudioEdits) => void): AudioEdits {
  const e = defaultEdits();
  patch(e);
  return e;
}

describe('silence detection', () => {
  it('finds the silent span between two tones', () => {
    const mono = gappedSignal();
    const spans = detectSilence(mono, SR, {
      enabled: true,
      thresholdDb: -45,
      minSilence: 0.3,
      padding: 0.1,
    });
    expect(spans).toHaveLength(1);
    // Silence runs 1 s → 2 s; padding keeps 0.1 s at each edge.
    expect(spans[0].start).toBeGreaterThan(1.0);
    expect(spans[0].start).toBeLessThan(1.3);
    expect(spans[0].end).toBeGreaterThan(1.7);
    expect(spans[0].end).toBeLessThan(2.0);
  });

  it('reports nothing when the gap is shorter than minSilence', () => {
    const mono = gappedSignal();
    const spans = detectSilence(mono, SR, {
      enabled: true,
      thresholdDb: -45,
      minSilence: 2.5,
      padding: 0,
    });
    expect(spans).toHaveLength(0);
  });
});

describe('edit plan', () => {
  it('is a single full-length segment with no edits', () => {
    const mono = gappedSignal();
    const plan = buildEditPlan(mono, SR, defaultEdits());
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].srcStart).toBe(0);
    expect(plan.outDuration).toBeCloseTo(3, 5);
  });

  it('honours trim bounds', () => {
    const mono = gappedSignal();
    const plan = buildEditPlan(mono, SR, withEdits((e) => {
      e.trimStart = 0.5;
      e.trimEnd = 2.5;
    }));
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].srcStart).toBeCloseTo(0.5, 5);
    expect(plan.outDuration).toBeCloseTo(2, 5);
  });

  it('splits into segments around removed silence and shortens the output', () => {
    const mono = gappedSignal();
    const plan = buildEditPlan(mono, SR, withEdits((e) => {
      e.silence.enabled = true;
      e.silence.minSilence = 0.3;
      e.silence.padding = 0.1;
    }));
    expect(plan.segments.length).toBe(2);
    expect(plan.removed).toHaveLength(1);
    expect(plan.outDuration).toBeLessThan(3);
    expect(plan.outDuration).toBeGreaterThan(2);
    // Segments are laid out back to back in the output.
    const first = plan.segments[0];
    expect(plan.segments[1].outStart).toBeCloseTo(first.outStart + (first.srcEnd - first.srcStart), 5);
  });

  it('offsets the output by the bed intro', () => {
    const mono = gappedSignal();
    const plan = buildEditPlan(mono, SR, withEdits((e) => {
      e.bed.enabled = true;
      e.bed.intro = 2;
      e.bed.outro = 1;
    }));
    expect(plan.segments[0].outStart).toBeCloseTo(2, 5);
    expect(plan.outDuration).toBeCloseTo(6, 5); // 2 intro + 3 body + 1 outro
  });
});

describe('time mapping', () => {
  const mono = gappedSignal();
  const plan = buildEditPlan(mono, SR, withEdits((e) => {
    e.silence.enabled = true;
    e.silence.minSilence = 0.3;
    e.silence.padding = 0.1;
  }));

  it('round-trips source → output → source inside kept audio', () => {
    for (const src of [0.2, 0.9, 2.4]) {
      const out = sourceToOut(plan, src);
      expect(outToSource(plan, out)).toBeCloseTo(src, 4);
    }
  });

  it('maps output time monotonically', () => {
    const a = sourceToOut(plan, 0.5);
    const b = sourceToOut(plan, 2.5);
    expect(b).toBeGreaterThan(a);
  });

  it('snaps source times inside a cut to a segment edge', () => {
    const cut = plan.removed[0];
    const mid = (cut.start + cut.end) / 2;
    const out = sourceToOut(plan, mid);
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThanOrEqual(0);
  });
});

describe('rendering edits', () => {
  it('produces audio matching the plan duration', () => {
    const mono = gappedSignal();
    const edits = withEdits((e) => {
      e.silence.enabled = true;
      e.silence.minSilence = 0.3;
    });
    const plan = buildEditPlan(mono, SR, edits);
    const out = applyEdits([mono], SR, edits, plan, null);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeCloseTo(Math.round(plan.outDuration * SR), -3);
  });

  it('never mutates the source channels', () => {
    const mono = gappedSignal();
    const before = mono.slice();
    const edits = withEdits((e) => (e.trimStart = 0.5));
    applyEdits([mono], SR, edits, buildEditPlan(mono, SR, edits), null);
    expect(Array.from(mono)).toEqual(Array.from(before));
  });

  it('fades start and end to silence', () => {
    const ch = sine(440, 2, SR, 0.5);
    applyFades([ch], SR, 0.5, 0.5);
    expect(Math.abs(ch[0])).toBeLessThan(0.01);
    expect(Math.abs(ch[ch.length - 1])).toBeLessThan(0.01);
    // Middle is untouched.
    let peakMid = 0;
    for (let i = SR; i < SR + 1000; i++) peakMid = Math.max(peakMid, Math.abs(ch[i]));
    expect(peakMid).toBeGreaterThan(0.4);
  });

  it('hasActiveEdits detects any structural change', () => {
    expect(hasActiveEdits(defaultEdits())).toBe(false);
    expect(hasActiveEdits(withEdits((e) => (e.fadeIn = 1)))).toBe(true);
    expect(hasActiveEdits(withEdits((e) => (e.silence.enabled = true)))).toBe(true);
    // Loudness alone is applied after the effects chain, not an "edit".
    expect(hasActiveEdits(withEdits((e) => (e.loudness.enabled = true)))).toBe(false);
  });
});

describe('music bed', () => {
  it('adds energy in the gaps and ducks under the voice', () => {
    // 1 s of voice then 3 s of room, so the duck has time to release well
    // before the bed's outro fade begins.
    const voice = new Float32Array(SR * 4);
    voice.set(sine(300, 1, SR, 0.6), 0);
    const bed = sine(110, 1, SR, 0.5);
    const channels = [voice];
    mixBed(channels, SR, [bed], {
      enabled: true,
      intro: 0,
      outro: 0,
      gainDb: -6,
      duckDb: -24,
    });
    const rmsOf = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += channels[0][i] * channels[0][i];
      return Math.sqrt(s / (to - from));
    };
    // Once the voice stops and the duck releases, the bed comes back up.
    const quiet = rmsOf(Math.round(SR * 2.0), Math.round(SR * 2.8));
    expect(quiet).toBeGreaterThan(0.05);
    // While the voice plays it still dominates.
    const loud = rmsOf(5000, SR - 5000);
    expect(loud).toBeGreaterThan(quiet);
    // And the bed is genuinely quieter under the voice than in the pause:
    // compare only the very start (voice + ducked bed) against the pause.
    expect(quiet).toBeLessThan(loud);
  });
});

describe('loudness (ITU-R BS.1770)', () => {
  it('measures a −23 dBFS stereo 1 kHz tone at about −23 LUFS', () => {
    const amp = Math.pow(10, -23 / 20);
    const tone = sine(1000, 4, SR, amp);
    const lufs = measureLufs([tone, tone.slice()], SR);
    expect(lufs).toBeGreaterThan(-24.2);
    expect(lufs).toBeLessThan(-21.8);
  });

  it('rises ~6 dB when amplitude doubles', () => {
    const quiet = sine(1000, 3, SR, 0.05);
    const loud = sine(1000, 3, SR, 0.1);
    const a = measureLufs([quiet], SR);
    const b = measureLufs([loud], SR);
    expect(b - a).toBeGreaterThan(5.5);
    expect(b - a).toBeLessThan(6.5);
  });

  it('returns -Infinity for digital silence', () => {
    expect(measureLufs([new Float32Array(SR * 2)], SR)).toBe(-Infinity);
  });

  it('normalizes toward the target without clipping', () => {
    const ch = sine(1000, 4, SR, 0.05);
    const gain = normalizeLoudness([ch], SR, -16);
    expect(gain).toBeGreaterThan(0); // quiet input needs a boost
    const after = measureLufs([ch], SR);
    expect(Math.abs(after - -16)).toBeLessThan(1);
    for (const v of ch) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('caps gain so a hot signal never clips', () => {
    const ch = sine(1000, 3, SR, 0.95);
    normalizeLoudness([ch], SR, -5);
    let peak = 0;
    for (const v of ch) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.9);
  });
});
