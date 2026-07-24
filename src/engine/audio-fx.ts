/**
 * Audio effects chain — pure, deterministic DSP.
 *
 * Everything here is plain TypeScript on Float32Array channels: no Web Audio,
 * no OfflineAudioContext, so it is byte-identical across browsers and runs in
 * Vitest. The chain is processed once (in a worker) to produce a new
 * AudioSource; features, playback and export all read that processed audio,
 * so the preview≡export contract is preserved.
 *
 * Signal flow is a fixed mastering-style order (see EFFECTS); each stage has
 * an independent enable toggle and a typed schema that drives the same
 * auto-generated controls used by visual layers.
 */

import { hannWindow } from './fft';
import { defaultConfig, type LayerConfig, type Schema } from './layers/api';

export interface EffectDef {
  /** Stable id, also the i18n key prefix (`fx.<id>`). */
  id: string;
  schema: Schema;
  /** Pure processor: returns new channels, never mutates the input. */
  process(channels: Float32Array[], sampleRate: number, cfg: LayerConfig): Float32Array[];
}

export interface EffectState {
  id: string;
  enabled: boolean;
  config: LayerConfig;
}

// ---------------------------------------------------------------- biquad (RBJ)

interface BiquadCoeffs {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

type FilterType = 'lowpass' | 'highpass' | 'lowshelf' | 'highshelf' | 'peaking';

function biquadCoeffs(type: FilterType, freq: number, sampleRate: number, q: number, gainDb = 0): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sin / (2 * q);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cos + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - s);
      a0 = (A + 1) + (A - 1) * cos + s;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cos + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - s);
      a0 = (A + 1) - (A - 1) * cos + s;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Direct-form-I biquad over one channel, fresh state. Returns a new array. */
function applyBiquad(x: Float32Array, c: BiquadCoeffs): Float32Array {
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

const clone = (chs: Float32Array[]): Float32Array[] => chs.map((c) => c.slice());
const perChannel = (chs: Float32Array[], fn: (c: Float32Array, i: number) => Float32Array): Float32Array[] =>
  chs.map(fn);

// ---------------------------------------------------------------- effects

/** High-pass + low-pass filter. Skips a stage that is effectively bypassed. */
function filter(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const hp = cfg.highpass as number;
  const lp = cfg.lowpass as number;
  return perChannel(channels, (ch) => {
    let out = ch;
    if (hp > 25) out = applyBiquad(out, biquadCoeffs('highpass', hp, sr, 0.707));
    if (lp < sr * 0.45) out = applyBiquad(out, biquadCoeffs('lowpass', lp, sr, 0.707));
    return out === ch ? ch.slice() : out;
  });
}

/** Noise gate: attenuates the signal while it sits below a threshold. */
function gate(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const thresh = Math.pow(10, (cfg.threshold as number) / 20);
  const floor = 1 - (cfg.reduction as number);
  const atk = Math.exp(-1 / ((cfg.attack as number) * 0.001 * sr));
  const rel = Math.exp(-1 / ((cfg.release as number) * 0.001 * sr));
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    let env = 0;
    let g = 1;
    for (let n = 0; n < ch.length; n++) {
      const a = Math.abs(ch[n]);
      env = a > env ? a : env * 0.9995 + a * 0.0005; // fast-attack level follow
      const target = env >= thresh ? 1 : floor;
      const coef = target < g ? atk : rel; // closing uses attack, opening uses release
      g = target + (g - target) * coef;
      out[n] = ch[n] * g;
    }
    return out;
  });
}

/** Three-band EQ: low shelf, mid peak, high shelf. */
function eq(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const low = biquadCoeffs('lowshelf', 160, sr, 0.707, cfg.low as number);
  const mid = biquadCoeffs('peaking', cfg.midFreq as number, sr, 1.0, cfg.mid as number);
  const high = biquadCoeffs('highshelf', 6000, sr, 0.707, cfg.high as number);
  return perChannel(channels, (ch) => applyBiquad(applyBiquad(applyBiquad(ch, low), mid), high));
}

/** Feed-forward dynamics compressor with makeup gain. */
function compressor(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const threshDb = cfg.threshold as number;
  const ratio = cfg.ratio as number;
  const atk = Math.exp(-1 / ((cfg.attack as number) * 0.001 * sr));
  const rel = Math.exp(-1 / ((cfg.release as number) * 0.001 * sr));
  const makeup = Math.pow(10, (cfg.makeup as number) / 20);
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    let envDb = -120;
    for (let n = 0; n < ch.length; n++) {
      const level = Math.abs(ch[n]) + 1e-9;
      const levelDb = 20 * Math.log10(level);
      const coef = levelDb > envDb ? atk : rel;
      envDb = levelDb + (envDb - levelDb) * coef;
      const overDb = envDb - threshDb;
      const grDb = overDb > 0 ? overDb - overDb / ratio : 0; // gain reduction (dB)
      out[n] = ch[n] * Math.pow(10, -grDb / 20) * makeup;
    }
    return out;
  });
}

/** Granular pitch shifter: OLA time-stretch, then resample back to length. */
function pitchShift(channels: Float32Array[], _sr: number, cfg: LayerConfig): Float32Array[] {
  const semitones = cfg.semitones as number;
  if (Math.abs(semitones) < 0.01) return clone(channels);
  const ratio = Math.pow(2, semitones / 12);
  const N = 2048;
  const Hs = N / 4; // synthesis hop
  const Ha = Hs / ratio; // analysis hop
  const win = hannWindow(N);
  return perChannel(channels, (ch) => {
    // 1) Overlap-add time-stretch to length ≈ ch.length * ratio.
    const stretchedLen = Math.max(N, Math.round(ch.length * ratio));
    const acc = new Float32Array(stretchedLen);
    const norm = new Float32Array(stretchedLen);
    let frame = 0;
    for (let sp = 0; sp + N <= stretchedLen; sp += Hs, frame++) {
      const ap = Math.round(frame * Ha);
      for (let k = 0; k < N; k++) {
        const idx = ap + k;
        if (idx < 0 || idx >= ch.length) continue;
        const wk = win[k];
        acc[sp + k] += ch[idx] * wk;
        norm[sp + k] += wk;
      }
    }
    for (let i = 0; i < stretchedLen; i++) if (norm[i] > 1e-6) acc[i] /= norm[i];
    // 2) Resample the stretched signal by `ratio` → original length, pitch·ratio.
    const out = new Float32Array(ch.length);
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = acc[i0] ?? 0;
      const b = acc[i0 + 1] ?? a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  });
}

/** Ring modulation — multiply by a sine carrier (classic robot voice). */
function ringMod(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const carrier = cfg.carrier as number;
  const mix = cfg.mix as number;
  const w = (2 * Math.PI * carrier) / sr;
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    for (let n = 0; n < ch.length; n++) {
      out[n] = ch[n] * (1 - mix) + ch[n] * Math.sin(w * n) * mix;
    }
    return out;
  });
}

/** Waveshaper distortion (tanh drive), level-compensated, wet/dry. */
function distortion(channels: Float32Array[], _sr: number, cfg: LayerConfig): Float32Array[] {
  const drive = cfg.drive as number;
  const mix = cfg.mix as number;
  const comp = Math.tanh(drive); // keep loudness roughly constant as drive rises
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    for (let n = 0; n < ch.length; n++) {
      const wet = Math.tanh(ch[n] * drive) / comp;
      out[n] = ch[n] * (1 - mix) + wet * mix;
    }
    return out;
  });
}

/** Bitcrusher: bit-depth quantization + sample-and-hold downsampling. */
function bitcrush(channels: Float32Array[], _sr: number, cfg: LayerConfig): Float32Array[] {
  const bits = cfg.bits as number;
  const ds = Math.max(1, Math.round(cfg.downsample as number));
  const mix = cfg.mix as number;
  const step = 1 / Math.pow(2, bits - 1);
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    let held = 0;
    for (let n = 0; n < ch.length; n++) {
      if (n % ds === 0) held = Math.round(ch[n] / step) * step;
      out[n] = ch[n] * (1 - mix) + held * mix;
    }
    return out;
  });
}

/** Feedback delay / echo. */
function echo(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const d = Math.max(1, Math.round((cfg.time as number) * 0.001 * sr));
  const fb = cfg.feedback as number;
  const mix = cfg.mix as number;
  return perChannel(channels, (ch) => {
    const s = new Float32Array(ch.length);
    const out = new Float32Array(ch.length);
    for (let n = 0; n < ch.length; n++) {
      s[n] = ch[n] + (n >= d ? s[n - d] * fb : 0);
      const wet = s[n] - ch[n];
      out[n] = ch[n] + wet * mix;
    }
    return out;
  });
}

// Schroeder reverb: parallel combs → series allpasses (per channel).
const COMB_TUNING = [1557, 1617, 1491, 1422];
const ALLPASS_TUNING = [225, 341];

function combFilter(x: Float32Array, delay: number, feedback: number, damp: number): Float32Array {
  const buf = new Float32Array(x.length);
  const d = Math.max(1, Math.round(delay));
  let store = 0;
  for (let n = 0; n < x.length; n++) {
    const delayed = n >= d ? buf[n - d] : 0;
    store = delayed * (1 - damp) + store * damp; // one-pole lowpass in the loop
    buf[n] = x[n] + store * feedback;
  }
  return buf;
}

function allpassFilter(x: Float32Array, delay: number, g: number): Float32Array {
  const buf = new Float32Array(x.length);
  const out = new Float32Array(x.length);
  const d = Math.max(1, Math.round(delay));
  for (let n = 0; n < x.length; n++) {
    const bufOut = n >= d ? buf[n - d] : 0;
    buf[n] = x[n] + bufOut * g;
    out[n] = -x[n] + bufOut;
  }
  return out;
}

function reverb(channels: Float32Array[], sr: number, cfg: LayerConfig): Float32Array[] {
  const size = cfg.size as number;
  const damp = (cfg.damp as number) * 0.4;
  const mix = cfg.mix as number;
  const feedback = 0.7 + size * 0.28; // 0.7..0.98
  const scale = sr / 44100;
  return perChannel(channels, (ch, ci) => {
    const spread = ci * 23; // small per-channel offset for width
    let wet: Float32Array = new Float32Array(ch.length);
    for (const tune of COMB_TUNING) {
      const c = combFilter(ch, (tune + spread) * scale, feedback, damp);
      for (let n = 0; n < wet.length; n++) wet[n] += c[n];
    }
    for (let n = 0; n < wet.length; n++) wet[n] *= 0.25;
    for (const tune of ALLPASS_TUNING) wet = allpassFilter(wet, (tune + spread) * scale, 0.5);
    const out = new Float32Array(ch.length);
    for (let n = 0; n < ch.length; n++) out[n] = ch[n] * (1 - mix) + wet[n] * mix;
    return out;
  });
}

/** Output stage: optional peak normalize, then gain. Applied last. */
function output(channels: Float32Array[], _sr: number, cfg: LayerConfig): Float32Array[] {
  const gain = Math.pow(10, (cfg.gain as number) / 20);
  let normScale = 1;
  if (cfg.normalize === true) {
    let peak = 1e-6;
    for (const ch of channels) for (let n = 0; n < ch.length; n++) peak = Math.max(peak, Math.abs(ch[n]));
    normScale = 0.891 / peak; // target ≈ -1 dBFS
  }
  const total = gain * normScale;
  return perChannel(channels, (ch) => {
    const out = new Float32Array(ch.length);
    for (let n = 0; n < ch.length; n++) out[n] = Math.max(-1, Math.min(1, ch[n] * total));
    return out;
  });
}

// ---------------------------------------------------------------- registry

export const EFFECTS: readonly EffectDef[] = [
  {
    id: 'fx-filter',
    schema: {
      highpass: { kind: 'slider', min: 20, max: 2000, step: 1, def: 20, unit: 'Hz' },
      lowpass: { kind: 'slider', min: 1000, max: 20000, step: 10, def: 20000, unit: 'Hz' },
    },
    process: filter,
  },
  {
    id: 'fx-gate',
    schema: {
      threshold: { kind: 'slider', min: -80, max: -10, step: 1, def: -45, unit: 'dB' },
      reduction: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.9 },
      attack: { kind: 'slider', min: 1, max: 50, step: 1, def: 5, unit: 'ms' },
      release: { kind: 'slider', min: 10, max: 500, step: 5, def: 120, unit: 'ms' },
    },
    process: gate,
  },
  {
    id: 'fx-eq',
    schema: {
      low: { kind: 'slider', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
      mid: { kind: 'slider', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
      high: { kind: 'slider', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
      midFreq: { kind: 'slider', min: 200, max: 5000, step: 10, def: 1000, unit: 'Hz' },
    },
    process: eq,
  },
  {
    id: 'fx-comp',
    schema: {
      threshold: { kind: 'slider', min: -40, max: 0, step: 1, def: -18, unit: 'dB' },
      ratio: { kind: 'slider', min: 1, max: 12, step: 0.5, def: 3 },
      attack: { kind: 'slider', min: 1, max: 50, step: 1, def: 8, unit: 'ms' },
      release: { kind: 'slider', min: 20, max: 400, step: 5, def: 120, unit: 'ms' },
      makeup: { kind: 'slider', min: 0, max: 24, step: 0.5, def: 4, unit: 'dB' },
    },
    process: compressor,
  },
  {
    id: 'fx-pitch',
    schema: {
      semitones: { kind: 'slider', min: -12, max: 12, step: 1, def: 0, unit: 'st' },
    },
    process: pitchShift,
  },
  {
    id: 'fx-ring',
    schema: {
      carrier: { kind: 'slider', min: 20, max: 2000, step: 1, def: 80, unit: 'Hz' },
      mix: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.6 },
    },
    process: ringMod,
  },
  {
    id: 'fx-distortion',
    schema: {
      drive: { kind: 'slider', min: 1, max: 40, step: 0.5, def: 6 },
      mix: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.7 },
    },
    process: distortion,
  },
  {
    id: 'fx-bitcrush',
    schema: {
      bits: { kind: 'slider', min: 1, max: 16, step: 1, def: 8, unit: 'bit' },
      downsample: { kind: 'slider', min: 1, max: 40, step: 1, def: 3, unit: '×' },
      mix: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 1 },
    },
    process: bitcrush,
  },
  {
    id: 'fx-echo',
    schema: {
      time: { kind: 'slider', min: 40, max: 1000, step: 5, def: 250, unit: 'ms' },
      feedback: { kind: 'slider', min: 0, max: 0.9, step: 0.01, def: 0.35 },
      mix: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
    },
    process: echo,
  },
  {
    id: 'fx-reverb',
    schema: {
      size: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
      damp: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
      mix: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
    },
    process: reverb,
  },
  {
    id: 'fx-output',
    schema: {
      gain: { kind: 'slider', min: -24, max: 24, step: 0.5, def: 0, unit: 'dB' },
      normalize: { kind: 'toggle', def: false },
    },
    process: output,
  },
];

const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

export function getEffectDef(id: string): EffectDef | undefined {
  return EFFECT_BY_ID.get(id);
}

export function defaultEffects(): EffectState[] {
  return EFFECTS.map((def) => ({ id: def.id, enabled: false, config: defaultConfig(def.schema) }));
}

export function hasActiveEffects(states: readonly EffectState[]): boolean {
  return states.some((s) => s.enabled);
}

/**
 * Run the chain in fixed order over a copy of the channels. Disabled stages
 * are skipped. Pure: `source` channels are never mutated.
 */
export function processChain(
  source: readonly Float32Array[],
  sampleRate: number,
  states: readonly EffectState[],
): Float32Array[] {
  let channels = clone(source as Float32Array[]);
  for (const def of EFFECTS) {
    const state = states.find((s) => s.id === def.id);
    if (!state || !state.enabled) continue;
    channels = def.process(channels, sampleRate, state.config);
  }
  return channels;
}

// ---------------------------------------------------------------- presets

export interface FxPreset {
  id: string;
  /** id → partial config overrides; listed ids are enabled. */
  chain: Record<string, LayerConfig>;
}

function preset(id: string, chain: Record<string, LayerConfig>): FxPreset {
  return { id, chain };
}

export const FX_PRESETS: readonly FxPreset[] = [
  preset('podcast-clean', {
    'fx-filter': { highpass: 85, lowpass: 20000 },
    'fx-gate': { threshold: -48, reduction: 0.7, attack: 5, release: 150 },
    'fx-eq': { low: 1, mid: 1.5, high: 3, midFreq: 2500 },
    'fx-comp': { threshold: -20, ratio: 3.5, attack: 8, release: 120, makeup: 5 },
    'fx-output': { gain: 0, normalize: true },
  }),
  preset('podcast-warm', {
    'fx-filter': { highpass: 70, lowpass: 20000 },
    'fx-eq': { low: 3, mid: -1, high: 1.5, midFreq: 900 },
    'fx-distortion': { drive: 2.5, mix: 0.14 },
    'fx-comp': { threshold: -22, ratio: 2.5, attack: 12, release: 140, makeup: 4 },
    'fx-output': { gain: 0, normalize: true },
  }),
  preset('anon-deep', {
    'fx-pitch': { semitones: -5 },
    'fx-filter': { highpass: 90, lowpass: 20000 },
    'fx-distortion': { drive: 3, mix: 0.2 },
    'fx-output': { gain: 0, normalize: true },
  }),
  preset('anon-high', {
    'fx-pitch': { semitones: 5 },
    'fx-filter': { highpass: 120, lowpass: 20000 },
    'fx-output': { gain: 0, normalize: true },
  }),
  preset('robot', {
    'fx-ring': { carrier: 70, mix: 0.7 },
    'fx-bitcrush': { bits: 6, downsample: 3, mix: 0.7 },
    'fx-output': { gain: 0, normalize: true },
  }),
  preset('telephone', {
    'fx-filter': { highpass: 400, lowpass: 3400 },
    'fx-distortion': { drive: 4, mix: 0.3 },
    'fx-output': { gain: 0, normalize: true },
  }),
];

/** Build a full EffectState[] from a preset (unlisted effects disabled). */
export function effectsFromPreset(p: FxPreset): EffectState[] {
  return EFFECTS.map((def) => {
    const override = p.chain[def.id];
    const config = defaultConfig(def.schema);
    if (override) for (const [k, v] of Object.entries(override)) config[k] = v;
    return { id: def.id, enabled: override !== undefined, config };
  });
}
