/**
 * Core engine types. Everything in /src/engine is framework-agnostic:
 * no DOM assumptions beyond Canvas/WebGL2 contexts passed in explicitly.
 */

/** Number of log-spaced spectrum bands in a FeatureTrack. */
export const BAND_COUNT = 64;

/**
 * Pre-computed, deterministic per-frame audio features.
 *
 * Everything the renderer needs is sampled at the project frame rate, so
 * preview and export read the exact same values for a given frame index —
 * frame N is pixel-identical in both modes by construction.
 *
 * All arrays are indexed by frame unless noted. Values are normalized 0..1.
 */
export interface FeatureTrack {
  /** Frames per second the features were sampled at (30 or 60). */
  readonly fps: number;
  /** Total number of analysis frames (ceil(duration * fps)). */
  readonly frameCount: number;
  /** Sample rate of the analyzed audio. */
  readonly sampleRate: number;
  /** Duration of the audio in seconds. */
  readonly duration: number;
  /**
   * Log-spaced spectrum magnitudes, `frameCount * BAND_COUNT` values,
   * frame-major (`bands[frame * BAND_COUNT + band]`). Smoothed with an
   * attack/release envelope for stable visuals. Range 0..1.
   */
  readonly bands: Float32Array;
  /** Per-frame RMS energy, 0..1 (normalized to track peak RMS). */
  readonly rms: Float32Array;
  /** Peak amplitude envelope with release smoothing, 0..1. */
  readonly env: Float32Array;
  /** Spectral centroid, 0..1 (0 = dark/bassy, 1 = bright). */
  readonly centroid: Float32Array;
  /** Raw spectral flux (onset detection function), normalized 0..1. */
  readonly flux: Float32Array;
  /** 1 where an onset/beat was detected, else 0. */
  readonly onsets: Uint8Array;
  /**
   * Beat pulse envelope: jumps to 1 on each onset and decays exponentially
   * (~0.25 s half-life). Use for "kick" reactions without re-deriving decay.
   */
  readonly beat: Float32Array;
}

/** Decoded audio, kept in memory for playback, raw-waveform layers and export. */
export interface AudioSource {
  readonly sampleRate: number;
  readonly duration: number;
  /** 1 or 2 channels of PCM data. */
  readonly channels: readonly Float32Array[];
  /** Mono mixdown used by the analyzer and waveform-based visualizers. */
  readonly mono: Float32Array;
  /** Original file name, if loaded from a file. */
  readonly fileName: string;
}

/**
 * Feature sampling accepts *fractional* frames: the preview runs at display
 * rate (e.g. 60 Hz over a 30 fps track) and interpolates linearly between
 * analysis frames for fluid motion. Export always samples integer frames, so
 * the fast integer path below is bit-exact with the pre-computed matrix and
 * preview frame N stays pixel-identical to export frame N.
 */

const lerpScratch = new Float32Array(BAND_COUNT);

/**
 * One frame's bands. Integer frames return a zero-copy view; fractional
 * frames return an interpolated snapshot in a shared scratch buffer —
 * consume it before the next bandsAt call (every layer does).
 */
export function bandsAt(f: FeatureTrack, frame: number): Float32Array {
  const clamped = Math.min(Math.max(frame, 0), f.frameCount - 1);
  const lo = Math.floor(clamped);
  if (lo === clamped || lo >= f.frameCount - 1) {
    const i = lo * BAND_COUNT;
    return f.bands.subarray(i, i + BAND_COUNT);
  }
  const t = clamped - lo;
  const a = lo * BAND_COUNT;
  const b = a + BAND_COUNT;
  for (let k = 0; k < BAND_COUNT; k++) {
    lerpScratch[k] = f.bands[a + k] * (1 - t) + f.bands[b + k] * t;
  }
  return lerpScratch;
}

function sampleLerp(arr: Float32Array, frameCount: number, frame: number): number {
  const clamped = Math.min(Math.max(frame, 0), frameCount - 1);
  const lo = Math.floor(clamped);
  if (lo === clamped || lo >= frameCount - 1) return arr[lo];
  const t = clamped - lo;
  return arr[lo] * (1 - t) + arr[lo + 1] * t;
}

/**
 * Box-averaged feature over the trailing `windowFrames` frames — used to
 * decouple slow-moving consumers (backgrounds) from frame-to-frame jitter.
 * Stateless: a pure window over the precomputed array, so seeking is exact.
 * windowFrames <= 1 falls back to interpolated instantaneous sampling.
 */
export function smoothedAt(arr: Float32Array, frameCount: number, frame: number, windowFrames: number): number {
  if (windowFrames <= 1) return sampleLerp(arr, frameCount, frame);
  const end = Math.floor(Math.min(Math.max(frame, 0), frameCount - 1));
  const start = Math.max(0, end - Math.round(windowFrames) + 1);
  let sum = 0;
  for (let i = start; i <= end; i++) sum += arr[i];
  return sum / (end - start + 1);
}

/**
 * How many onsets have occurred up to (and including) `frame`.
 * Backed by a lazily-built prefix sum cached per FeatureTrack, so callers can
 * use it every frame without going quadratic on long files. Deterministic:
 * a pure function of the track and the frame index.
 */
const onsetPrefixCache = new WeakMap<Uint8Array, Uint32Array>();

export function onsetCountAt(f: FeatureTrack, frame: number): number {
  let prefix = onsetPrefixCache.get(f.onsets);
  if (!prefix) {
    prefix = new Uint32Array(f.frameCount);
    let acc = 0;
    for (let i = 0; i < f.frameCount; i++) {
      acc += f.onsets[i];
      prefix[i] = acc;
    }
    onsetPrefixCache.set(f.onsets, prefix);
  }
  const i = Math.min(Math.max(Math.floor(frame), 0), f.frameCount - 1);
  return prefix[i];
}

export function rmsAt(f: FeatureTrack, frame: number): number {
  return sampleLerp(f.rms, f.frameCount, frame);
}
export function envAt(f: FeatureTrack, frame: number): number {
  return sampleLerp(f.env, f.frameCount, frame);
}
export function centroidAt(f: FeatureTrack, frame: number): number {
  return sampleLerp(f.centroid, f.frameCount, frame);
}
export function beatAt(f: FeatureTrack, frame: number): number {
  return sampleLerp(f.beat, f.frameCount, frame);
}

/**
 * Palettes are picked per scope, so the studio chrome, background,
 * visualizers and overlays can each use a different palette.
 */
export const THEME_SCOPES = ['app', 'background', 'visualizer', 'overlay'] as const;
export type ThemeScope = (typeof THEME_SCOPES)[number];
export type ThemeScopes = Record<ThemeScope, string>;

export function defaultThemeScopes(id = 'ember'): ThemeScopes {
  return { app: id, background: id, visualizer: id, overlay: id };
}

/** Theme palette used by layers ("theme slots" A/B/C + background tint). */
export interface ThemeColors {
  /** Primary accent (bars, main strokes). */
  a: string;
  /** Secondary accent (glows, gradients). */
  b: string;
  /** Tertiary accent (highlights, particles). */
  c: string;
  /** Deep background tint for solid backgrounds / shader bases. */
  bg: string;
}
