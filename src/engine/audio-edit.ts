/**
 * Timeline audio editing — pure, deterministic DSP.
 *
 * Pipeline position:  source → **edits** → effects → loudness → features
 *
 * "Edits" are structural changes to the timeline (trim, silence removal,
 * fades, music bed), as opposed to `audio-fx.ts` which is tonal processing.
 * Loudness normalization lives here too but is applied *last* (after effects)
 * so the delivered file actually hits its LUFS target.
 *
 * Like the effects chain this is plain TypeScript over Float32Array channels:
 * no Web Audio, so it is byte-identical everywhere and unit-testable in Node.
 */

export interface SilenceOptions {
  enabled: boolean;
  /** Level below which audio counts as silence, dBFS. */
  thresholdDb: number;
  /** Only remove silences at least this long, seconds. */
  minSilence: number;
  /** Keep this much silence at each edge of a cut, seconds ("breath"). */
  padding: number;
}

export interface BedOptions {
  enabled: boolean;
  /** Seconds of bed alone before the voice starts. */
  intro: number;
  /** Seconds of bed alone after the voice ends. */
  outro: number;
  /** Bed level when no voice is present, dB. */
  gainDb: number;
  /** How far the bed drops while the voice plays, dB (negative). */
  duckDb: number;
}

export interface AudioEdits {
  /** Keep only [trimStart, trimEnd] of the source, seconds. trimEnd<=0 ⇒ end. */
  trimStart: number;
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  silence: SilenceOptions;
  bed: BedOptions;
  loudness: {
    enabled: boolean;
    /** Target integrated loudness, LUFS (−16 podcast, −14 YouTube). */
    targetLufs: number;
  };
}

export function defaultEdits(): AudioEdits {
  return {
    trimStart: 0,
    trimEnd: 0,
    fadeIn: 0,
    fadeOut: 0,
    silence: { enabled: false, thresholdDb: -45, minSilence: 0.5, padding: 0.15 },
    bed: { enabled: false, intro: 3, outro: 3, gainDb: -12, duckDb: -15 },
    loudness: { enabled: false, targetLufs: -16 },
  };
}

/** True when the edits would change the audio at all (cheap bypass check). */
export function hasActiveEdits(e: AudioEdits): boolean {
  return (
    e.trimStart > 0 ||
    e.trimEnd > 0 ||
    e.fadeIn > 0 ||
    e.fadeOut > 0 ||
    e.silence.enabled ||
    e.bed.enabled
  );
}

/**
 * One retained span of source audio and where it lands in the output.
 * Lets the UI map playhead ↔ source time across cuts.
 */
export interface EditSegment {
  srcStart: number;
  srcEnd: number;
  outStart: number;
}

export interface EditPlan {
  segments: EditSegment[];
  /** Silence spans (source time) that were removed — drawn on the waveform. */
  removed: Array<{ start: number; end: number }>;
  srcDuration: number;
  outDuration: number;
}

// ---------------------------------------------------------------- silence

/**
 * Find silent spans in `mono` (source seconds). A span qualifies when the
 * short-term RMS stays below the threshold for at least `minSilence`.
 * `padding` is kept at each edge, so only the excess is reported.
 */
export function detectSilence(
  mono: Float32Array,
  sampleRate: number,
  opts: SilenceOptions,
): Array<{ start: number; end: number }> {
  const win = Math.max(1, Math.round(sampleRate * 0.02)); // 20 ms analysis hop
  const thresh = Math.pow(10, opts.thresholdDb / 20);
  const frames = Math.floor(mono.length / win);
  const quiet = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    let sq = 0;
    const base = f * win;
    for (let i = 0; i < win; i++) sq += mono[base + i] * mono[base + i];
    quiet[f] = Math.sqrt(sq / win) < thresh ? 1 : 0;
  }

  const out: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  const flush = (endFrame: number) => {
    if (runStart < 0) return;
    const start = (runStart * win) / sampleRate;
    const end = (endFrame * win) / sampleRate;
    if (end - start >= opts.minSilence) {
      // Leave `padding` of room at both edges so cuts don't sound clipped.
      const s = start + opts.padding;
      const e = end - opts.padding;
      if (e > s) out.push({ start: s, end: e });
    }
    runStart = -1;
  };
  for (let f = 0; f < frames; f++) {
    if (quiet[f]) {
      if (runStart < 0) runStart = f;
    } else flush(f);
  }
  flush(frames);
  return out;
}

/**
 * Build the retained-segment plan for a set of edits. Pure geometry over
 * source time — no audio is touched here, so the UI can call it cheaply.
 */
export function buildEditPlan(
  mono: Float32Array,
  sampleRate: number,
  edits: AudioEdits,
): EditPlan {
  const srcDuration = mono.length / sampleRate;
  const start = Math.max(0, Math.min(edits.trimStart, srcDuration));
  const end = edits.trimEnd > 0 ? Math.min(edits.trimEnd, srcDuration) : srcDuration;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  const removed = edits.silence.enabled
    ? detectSilence(mono, sampleRate, edits.silence).filter((r) => r.end > lo && r.start < hi)
    : [];

  const segments: EditSegment[] = [];
  let cursor = lo;
  let outStart = edits.bed.enabled ? edits.bed.intro : 0;
  for (const r of removed) {
    const cutStart = Math.max(lo, r.start);
    if (cutStart > cursor) {
      segments.push({ srcStart: cursor, srcEnd: cutStart, outStart });
      outStart += cutStart - cursor;
    }
    cursor = Math.max(cursor, Math.min(hi, r.end));
  }
  if (cursor < hi) {
    segments.push({ srcStart: cursor, srcEnd: hi, outStart });
    outStart += hi - cursor;
  }

  const outDuration = outStart + (edits.bed.enabled ? edits.bed.outro : 0);
  return { segments, removed, srcDuration, outDuration };
}

/** Map output (playback) time → source time, or null inside bed-only spans. */
export function outToSource(plan: EditPlan, outTime: number): number | null {
  for (const s of plan.segments) {
    const len = s.srcEnd - s.srcStart;
    if (outTime >= s.outStart && outTime <= s.outStart + len) {
      return s.srcStart + (outTime - s.outStart);
    }
  }
  return null;
}

/** Map source time → output time, snapping to the nearest retained segment. */
export function sourceToOut(plan: EditPlan, srcTime: number): number {
  if (plan.segments.length === 0) return 0;
  for (const s of plan.segments) {
    if (srcTime >= s.srcStart && srcTime <= s.srcEnd) {
      return s.outStart + (srcTime - s.srcStart);
    }
  }
  // Inside a cut or outside the trim: snap to the closest segment edge.
  let best = plan.segments[0];
  let bestDist = Infinity;
  for (const s of plan.segments) {
    const d = srcTime < s.srcStart ? s.srcStart - srcTime : srcTime - s.srcEnd;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return srcTime < best.srcStart ? best.outStart : best.outStart + (best.srcEnd - best.srcStart);
}

// ---------------------------------------------------------------- assembly

const CROSSFADE_S = 0.006; // 6 ms — hides cut discontinuities

/**
 * Render the plan: concatenate retained segments with short crossfades,
 * then apply fades and (optionally) mix the music bed under it.
 * Never mutates the input.
 */
export function applyEdits(
  channels: readonly Float32Array[],
  sampleRate: number,
  edits: AudioEdits,
  plan: EditPlan,
  bed: readonly Float32Array[] | null,
): Float32Array[] {
  const chCount = channels.length;
  const outLen = Math.max(1, Math.round(plan.outDuration * sampleRate));
  const out: Float32Array[] = Array.from({ length: chCount }, () => new Float32Array(outLen));
  const xf = Math.round(CROSSFADE_S * sampleRate);

  for (const seg of plan.segments) {
    const s0 = Math.round(seg.srcStart * sampleRate);
    const s1 = Math.round(seg.srcEnd * sampleRate);
    const o0 = Math.round(seg.outStart * sampleRate);
    const n = Math.min(s1 - s0, outLen - o0);
    for (let c = 0; c < chCount; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < n; i++) {
        const v = src[s0 + i] ?? 0;
        // Ramp each segment in/out so splices don't click.
        let g = 1;
        if (i < xf) g = i / xf;
        else if (i > n - xf) g = Math.max(0, (n - i) / xf);
        dst[o0 + i] += v * g;
      }
    }
  }

  applyFades(out, sampleRate, edits.fadeIn, edits.fadeOut);
  if (edits.bed.enabled && bed && bed.length > 0) mixBed(out, sampleRate, bed, edits.bed);
  return out;
}

/** Cosine (equal-power) fade in/out, in place. */
export function applyFades(channels: Float32Array[], sampleRate: number, fadeIn: number, fadeOut: number): void {
  const n = channels[0]?.length ?? 0;
  const inN = Math.min(n, Math.round(fadeIn * sampleRate));
  const outN = Math.min(n, Math.round(fadeOut * sampleRate));
  for (const ch of channels) {
    for (let i = 0; i < inN; i++) ch[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / inN);
    for (let i = 0; i < outN; i++) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / outN);
      ch[n - 1 - i] *= g;
    }
  }
}

/**
 * Mix a looped music bed under the voice with sidechain ducking: the bed
 * sits at `gainDb` and drops by `duckDb` whenever the voice is present.
 */
export function mixBed(
  channels: Float32Array[],
  sampleRate: number,
  bed: readonly Float32Array[],
  opts: BedOptions,
): void {
  const n = channels[0].length;
  const bedGain = Math.pow(10, opts.gainDb / 20);
  const duckGain = Math.pow(10, (opts.gainDb + opts.duckDb) / 20);

  // Voice envelope drives the duck: grab it fast, let go over ~0.25 s so the
  // bed comes back up in natural pauses instead of staying flattened.
  const atk = Math.exp(-1 / (0.02 * sampleRate));
  const rel = Math.exp(-1 / (0.25 * sampleRate));
  const env = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
    e = peak > e ? peak + (e - peak) * atk : peak + (e - peak) * rel;
    env[i] = e;
  }

  // Always ease the bed in/out so it never starts or stops abruptly,
  // capped to a quarter of the piece for very short clips.
  const bedFade = Math.round(Math.min(1.5 * sampleRate, n / 4));
  for (let c = 0; c < channels.length; c++) {
    const src = bed[Math.min(c, bed.length - 1)];
    const dst = channels[c];
    if (src.length === 0) continue;
    for (let i = 0; i < n; i++) {
      // Duck proportionally to how loud the voice is right now.
      const duck = Math.min(1, env[i] / 0.06);
      const g = bedGain + (duckGain - bedGain) * duck;
      let fade = 1;
      if (bedFade > 0) {
        if (i < bedFade) fade = i / bedFade;
        else if (i > n - bedFade) fade = Math.max(0, (n - i) / bedFade);
      }
      dst[i] += src[i % src.length] * g * fade;
    }
  }
}

// ---------------------------------------------------------------- loudness

/**
 * Integrated loudness per ITU-R BS.1770-4 (K-weighting, 400 ms blocks with
 * 75 % overlap, absolute −70 LUFS gate + −10 LU relative gate).
 * Returns LUFS, or −Infinity for digital silence.
 */
export function measureLufs(channels: readonly Float32Array[], sampleRate: number): number {
  const filtered = channels.map((ch) => kWeight(ch, sampleRate));
  const blockLen = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const n = filtered[0]?.length ?? 0;
  if (n < blockLen) return -Infinity;

  // Per-block mean square for each channel (all weights are 1.0 for L/R).
  const blocks: number[][] = [];
  for (let start = 0; start + blockLen <= n; start += hop) {
    const row: number[] = [];
    for (const ch of filtered) {
      let sq = 0;
      for (let i = 0; i < blockLen; i++) sq += ch[start + i] * ch[start + i];
      row.push(sq / blockLen);
    }
    blocks.push(row);
  }
  if (blocks.length === 0) return -Infinity;

  const loudnessOf = (row: number[]): number => {
    const sum = row.reduce((a, b) => a + b, 0);
    return sum > 0 ? -0.691 + 10 * Math.log10(sum) : -Infinity;
  };
  const meanOf = (sel: number[][]): number[] => {
    const ch = sel[0].length;
    const acc = new Array<number>(ch).fill(0);
    for (const row of sel) for (let c = 0; c < ch; c++) acc[c] += row[c];
    return acc.map((v) => v / sel.length);
  };

  const absGated = blocks.filter((row) => loudnessOf(row) > -70);
  if (absGated.length === 0) return -Infinity;
  const relThreshold = loudnessOf(meanOf(absGated)) - 10;
  const gated = absGated.filter((row) => loudnessOf(row) > relThreshold);
  if (gated.length === 0) return -Infinity;
  return loudnessOf(meanOf(gated));
}

/**
 * Normalize to a target integrated loudness. Gain is capped so the result
 * never exceeds `ceiling` (sample peak), trading exactness for no clipping.
 * Returns the applied gain in dB.
 */
export function normalizeLoudness(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs: number,
  ceiling = 0.891, // ≈ −1 dBFS
): number {
  const current = measureLufs(channels, sampleRate);
  if (!Number.isFinite(current)) return 0;
  let gain = Math.pow(10, (targetLufs - current) / 20);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak * gain > ceiling) gain = ceiling / Math.max(peak, 1e-9);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

/** BS.1770 K-weighting: high-shelf "head" filter + RLB high-pass. */
function kWeight(x: Float32Array, sampleRate: number): Float32Array {
  const shelf = highShelf(1681.974450955533, 3.999843853973347, 0.7071752369554196, sampleRate);
  const hp = highPass(38.13547087602444, 0.5003270373238773, sampleRate);
  return biquad(biquad(x, shelf), hp);
}

interface Coeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

function highShelf(f0: number, gainDb: number, q: number, fs: number): Coeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const sq = 2 * Math.sqrt(A) * alpha;
  const a0 = (A + 1) - (A - 1) * cos + sq;
  return {
    b0: (A * ((A + 1) + (A - 1) * cos + sq)) / a0,
    b1: (-2 * A * ((A - 1) + (A + 1) * cos)) / a0,
    b2: (A * ((A + 1) + (A - 1) * cos - sq)) / a0,
    a1: (2 * ((A - 1) - (A + 1) * cos)) / a0,
    a2: ((A + 1) - (A - 1) * cos - sq) / a0,
  };
}

function highPass(f0: number, q: number, fs: number): Coeffs {
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function biquad(x: Float32Array, c: Coeffs): Float32Array {
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    out[n] = yn;
  }
  return out;
}

/** Loudness presets offered in the UI. */
export const LOUDNESS_TARGETS = [
  { id: 'podcast', lufs: -16 },
  { id: 'youtube', lufs: -14 },
  { id: 'broadcast', lufs: -23 },
] as const;
