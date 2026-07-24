/**
 * Project state + JSON save/load. Uploaded images are referenced by file
 * name only (the file itself never leaves the user's machine), so loading a
 * project restores every setting and asks the user to re-pick named images.
 */

import { defaultConfig, defaultPlacement, type ImageRef, type LayerConfig, type Placement } from './layers/api';
import { BACKGROUNDS, getLayerDef, OVERLAYS, VISUALIZERS } from './registry';
import { defaultEffects, EFFECTS, getEffectDef, type EffectState } from './audio-fx';
import { defaultEdits, type AudioEdits } from './audio-edit';
import type { CaptionTrack } from './captions';
import { defaultThemeScopes, THEME_SCOPES, type ThemeScopes } from './types';

export type AspectId = '16:9' | '1:1' | '9:16';
export const ASPECTS: Record<AspectId, number> = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };
/** Output heights offered in the export dialog (width follows aspect). */
export const RESOLUTIONS = [360, 720, 1080, 1440, 2160] as const;
/** 120 fps is offered but capped to ≤1080p by the encoder-level probe. */
export const FRAME_RATES = [30, 60, 120] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

export interface LayerState {
  id: string;
  enabled: boolean;
  config: LayerConfig;
}

/** A visualizer instance: preset + config + where it sits on the canvas. */
export interface VisualizerState extends LayerState {
  placement: Placement;
}

/** Maximum simultaneous visualizer instances (UI + perf guard). */
export const MAX_VISUALIZERS = 4;

export interface ProjectState {
  fps: FrameRate;
  aspect: AspectId;
  /** Export vertical resolution; width derives from aspect (rounded to even). */
  resolution: number;
  /** Per-scope palettes (app chrome, background, visualizers, overlays). */
  themes: ThemeScopes;
  /** Timeline edits applied before the effects chain. */
  edits: AudioEdits;
  background: LayerState;
  visualizers: VisualizerState[];
  overlays: LayerState[];
  /** Audio effects chain, aligned to the EFFECTS registry order. */
  effects: EffectState[];
  /** Transcribed captions, if any. Rendered by the caption overlay. */
  captions: CaptionTrack | null;
  audioFileName: string | null;
}

export function defaultVisualizer(id: string = VISUALIZERS[0].id): VisualizerState {
  const def = VISUALIZERS.find((d) => d.id === id) ?? VISUALIZERS[0];
  return { id: def.id, enabled: true, config: defaultConfig(def.schema), placement: defaultPlacement() };
}

export function defaultProject(): ProjectState {
  return {
    fps: 60,
    aspect: '16:9',
    resolution: 1080,
    themes: defaultThemeScopes('ember'),
    edits: defaultEdits(),
    background: { id: BACKGROUNDS[0].id, enabled: true, config: defaultConfig(BACKGROUNDS[0].schema) },
    visualizers: [defaultVisualizer()],
    overlays: OVERLAYS.map((def) => ({
      id: def.id,
      enabled: def.id === 'ov-progress',
      config: defaultConfig(def.schema),
    })),
    effects: defaultEffects(),
    captions: null,
    audioFileName: null,
  };
}

export function exportSize(p: ProjectState): { width: number; height: number } {
  const height = p.resolution;
  const width = 2 * Math.round((height * ASPECTS[p.aspect]) / 2);
  return { width, height };
}

// ---------- Serialization ----------

// v5: per-scope `themes` + timeline `edits`. v4: `captions` track.
// v3: audio `effects` chain. v2: `visualizers` array with placement.
// v1: single `visualizer`. Older versions load with sensible defaults.
const FORMAT_VERSION = 5;

interface SerializedImage {
  __voxImage: string; // file name
}

function serializeConfig(config: LayerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v && typeof v === 'object' && 'bitmap' in v) {
      out[k] = { __voxImage: (v as ImageRef).fileName } satisfies SerializedImage;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function serializeProject(p: ProjectState): string {
  const doc = {
    app: 'vox-orbita',
    version: FORMAT_VERSION,
    fps: p.fps,
    aspect: p.aspect,
    resolution: p.resolution,
    themes: { ...p.themes },
    edits: p.edits, // plain data — JSON.stringify below deep-copies it

    audioFileName: p.audioFileName,
    background: { id: p.background.id, enabled: p.background.enabled, config: serializeConfig(p.background.config) },
    visualizers: p.visualizers.map((v) => ({
      id: v.id,
      enabled: v.enabled,
      config: serializeConfig(v.config),
      placement: { ...v.placement },
    })),
    overlays: p.overlays.map((o) => ({ id: o.id, enabled: o.enabled, config: serializeConfig(o.config) })),
    effects: p.effects.map((fx) => ({ id: fx.id, enabled: fx.enabled, config: serializeConfig(fx.config) })),
    captions: p.captions,
  };
  return JSON.stringify(doc, null, 2);
}

/** Validate/normalize timeline edits loaded from JSON (defensive). */
function loadEdits(input: unknown): AudioEdits {
  const e = defaultEdits();
  if (typeof input !== 'object' || input === null) return e;
  const raw = input as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

  e.trimStart = num(raw.trimStart, 0, 1e6, e.trimStart);
  e.trimEnd = num(raw.trimEnd, 0, 1e6, e.trimEnd);
  e.fadeIn = num(raw.fadeIn, 0, 30, e.fadeIn);
  e.fadeOut = num(raw.fadeOut, 0, 30, e.fadeOut);

  const s = raw.silence as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') {
    e.silence.enabled = s.enabled === true;
    e.silence.thresholdDb = num(s.thresholdDb, -80, -10, e.silence.thresholdDb);
    e.silence.minSilence = num(s.minSilence, 0.1, 5, e.silence.minSilence);
    e.silence.padding = num(s.padding, 0, 1, e.silence.padding);
  }
  const b = raw.bed as Record<string, unknown> | undefined;
  if (b && typeof b === 'object') {
    e.bed.enabled = b.enabled === true;
    e.bed.intro = num(b.intro, 0, 60, e.bed.intro);
    e.bed.outro = num(b.outro, 0, 60, e.bed.outro);
    e.bed.gainDb = num(b.gainDb, -40, 0, e.bed.gainDb);
    e.bed.duckDb = num(b.duckDb, -40, 0, e.bed.duckDb);
  }
  const l = raw.loudness as Record<string, unknown> | undefined;
  if (l && typeof l === 'object') {
    e.loudness.enabled = l.enabled === true;
    e.loudness.targetLufs = num(l.targetLufs, -40, -5, e.loudness.targetLufs);
  }
  return e;
}

/** Validate/normalize a caption track loaded from JSON (defensive). */
function loadCaptions(input: unknown): CaptionTrack | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.lines)) return null;
  const lines = raw.lines.flatMap((l) => {
    if (typeof l !== 'object' || l === null) return [];
    const li = l as Record<string, unknown>;
    if (typeof li.start !== 'number' || typeof li.end !== 'number' || typeof li.text !== 'string') return [];
    const words = Array.isArray(li.words)
      ? li.words.flatMap((wRaw) => {
          if (typeof wRaw !== 'object' || wRaw === null) return [];
          const wi = wRaw as Record<string, unknown>;
          if (typeof wi.text !== 'string' || typeof wi.start !== 'number' || typeof wi.end !== 'number') return [];
          return [{ text: wi.text, start: wi.start, end: wi.end }];
        })
      : [];
    return [{ start: li.start, end: li.end, text: li.text, words }];
  });
  return { lines, language: typeof raw.language === 'string' ? raw.language : 'auto' };
}

export interface LoadedProject {
  state: ProjectState;
  /** File names of images the user needs to re-attach. */
  missingImages: string[];
  /** Audio file name recorded in the project, if any. */
  audioFileName: string | null;
}

/** Parse + validate a project JSON, merging configs over schema defaults. */
export function deserializeProject(json: string): LoadedProject {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a Vox Orbita project file');
  const doc = raw as Record<string, unknown>;
  if (doc.app !== 'vox-orbita' && doc.app !== 'voxwave') throw new Error('Not a Vox Orbita project file');
  if (typeof doc.version !== 'number' || doc.version > FORMAT_VERSION) {
    throw new Error(`Unsupported project version: ${String(doc.version)}`);
  }

  const missingImages: string[] = [];
  const base = defaultProject();

  const loadLayer = (input: unknown, fallback: LayerState, allowed: readonly { id: string }[]): LayerState => {
    if (typeof input !== 'object' || input === null) return fallback;
    const li = input as Record<string, unknown>;
    const id = typeof li.id === 'string' && allowed.some((d) => d.id === li.id) ? li.id : fallback.id;
    const def = getLayerDef(id)!;
    const config = defaultConfig(def.schema);
    const rawCfg = (typeof li.config === 'object' && li.config !== null ? li.config : {}) as Record<string, unknown>;
    for (const [k, spec] of Object.entries(def.schema)) {
      const v = rawCfg[k];
      if (v === undefined) continue;
      if (spec.kind === 'image') {
        if (v && typeof v === 'object' && '__voxImage' in v) {
          missingImages.push(String((v as SerializedImage).__voxImage));
        }
        continue; // image data can't be restored from JSON
      }
      if (spec.kind === 'slider' && typeof v === 'number') config[k] = Math.min(spec.max, Math.max(spec.min, v));
      else if (spec.kind === 'toggle' && typeof v === 'boolean') config[k] = v;
      else if (spec.kind === 'select' && typeof v === 'string' && spec.options.includes(v)) config[k] = v;
      else if ((spec.kind === 'color' || spec.kind === 'text') && typeof v === 'string') config[k] = v;
    }
    return { id, enabled: typeof li.enabled === 'boolean' ? li.enabled : fallback.enabled, config };
  };

  const loadPlacement = (input: unknown): Placement => {
    const p = defaultPlacement();
    if (typeof input === 'object' && input !== null) {
      const raw = input as Record<string, unknown>;
      if (typeof raw.x === 'number') p.x = Math.min(1, Math.max(0, raw.x));
      if (typeof raw.y === 'number') p.y = Math.min(1, Math.max(0, raw.y));
      if (typeof raw.scale === 'number') p.scale = Math.min(2, Math.max(0.2, raw.scale));
    }
    return p;
  };

  // v2 stores an array; v1 stored a single `visualizer` — migrate it.
  const rawVis: unknown[] = Array.isArray(doc.visualizers)
    ? (doc.visualizers as unknown[])
    : doc.visualizer !== undefined
      ? [doc.visualizer]
      : [];
  const fallbackVis = defaultVisualizer();
  const visualizers: VisualizerState[] = rawVis.slice(0, MAX_VISUALIZERS).map((v) => ({
    ...loadLayer(v, fallbackVis, VISUALIZERS),
    placement: loadPlacement(typeof v === 'object' && v !== null ? (v as Record<string, unknown>).placement : undefined),
  }));
  if (visualizers.length === 0) visualizers.push(defaultVisualizer());

  // Effects (v3+): merge saved config over schema defaults, keep registry order.
  const rawEffects = Array.isArray(doc.effects) ? (doc.effects as unknown[]) : [];
  const effects: EffectState[] = EFFECTS.map((def) => {
    const fallback: EffectState = { id: def.id, enabled: false, config: defaultConfig(def.schema) };
    const match = rawEffects.find((f) => typeof f === 'object' && f !== null && (f as { id?: string }).id === def.id);
    if (!match) return fallback;
    const li = match as Record<string, unknown>;
    const config = defaultConfig(def.schema);
    const rawCfg = (typeof li.config === 'object' && li.config !== null ? li.config : {}) as Record<string, unknown>;
    for (const [k, spec] of Object.entries(def.schema)) {
      const v = rawCfg[k];
      if (v === undefined) continue;
      if (spec.kind === 'slider' && typeof v === 'number') config[k] = Math.min(spec.max, Math.max(spec.min, v));
      else if (spec.kind === 'toggle' && typeof v === 'boolean') config[k] = v;
      else if (spec.kind === 'select' && typeof v === 'string' && spec.options.includes(v)) config[k] = v;
    }
    return { id: def.id, enabled: typeof li.enabled === 'boolean' ? li.enabled : false, config };
  });
  void getEffectDef;

  // v5 stores per-scope palettes; v1–v4 stored a single `theme` — fan it out.
  const themes = defaultThemeScopes(typeof doc.theme === 'string' ? doc.theme : base.themes.app);
  if (typeof doc.themes === 'object' && doc.themes !== null) {
    const raw = doc.themes as Record<string, unknown>;
    for (const scope of THEME_SCOPES) {
      if (typeof raw[scope] === 'string') themes[scope] = raw[scope];
    }
  }

  const state: ProjectState = {
    fps: FRAME_RATES.includes(doc.fps as FrameRate) ? (doc.fps as FrameRate) : base.fps,
    aspect: typeof doc.aspect === 'string' && doc.aspect in ASPECTS ? (doc.aspect as AspectId) : base.aspect,
    resolution: RESOLUTIONS.includes(doc.resolution as (typeof RESOLUTIONS)[number]) ? (doc.resolution as number) : base.resolution,
    themes,
    edits: loadEdits(doc.edits),
    background: loadLayer(doc.background, base.background, BACKGROUNDS),
    visualizers,
    overlays: base.overlays.map((fallback) => {
      const arr = Array.isArray(doc.overlays) ? (doc.overlays as unknown[]) : [];
      const match = arr.find((o) => typeof o === 'object' && o !== null && (o as { id?: string }).id === fallback.id);
      return loadLayer(match, fallback, OVERLAYS);
    }),
    effects,
    captions: loadCaptions(doc.captions),
    audioFileName: typeof doc.audioFileName === 'string' ? doc.audioFileName : null,
  };

  return { state, missingImages, audioFileName: state.audioFileName };
}
