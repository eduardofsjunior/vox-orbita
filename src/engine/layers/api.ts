/**
 * Layer plugin API. A frame is composed background → visualizer → overlays.
 * Each layer is a plugin with a typed config schema; the schema drives the
 * auto-generated controls panel, so new presets need zero UI code.
 */

import type { AudioSource, FeatureTrack, ThemeColors } from '../types';
import type { CaptionTrack } from '../captions';
import type { GLRenderer } from '../gl';

/** A color value: '#rrggbb' hex, or a theme slot reference. */
export type ColorValue = string | 'theme:a' | 'theme:b' | 'theme:c' | 'theme:bg';

export type FieldSpec =
  | { kind: 'slider'; min: number; max: number; step: number; def: number; unit?: string }
  | { kind: 'color'; def: ColorValue }
  | { kind: 'toggle'; def: boolean }
  | { kind: 'select'; options: readonly string[]; def: string }
  | { kind: 'text'; def: string; multiline?: boolean }
  | { kind: 'image'; def: null };

export type Schema = Record<string, FieldSpec>;

/** Runtime config derived from a schema (image fields hold ImageRef | null). */
export type ConfigOf<S extends Schema> = {
  [K in keyof S]: S[K] extends { kind: 'slider' } ? number
    : S[K] extends { kind: 'color' } ? ColorValue
    : S[K] extends { kind: 'toggle' } ? boolean
    : S[K] extends { kind: 'select' } ? string
    : S[K] extends { kind: 'text' } ? string
    : S[K] extends { kind: 'image' } ? ImageRef | null
    : never;
};

export type LayerConfig = Record<string, unknown>;

/** User-provided image (logo, background). Kept as ImageBitmap for speed. */
export interface ImageRef {
  bitmap: ImageBitmap;
  fileName: string;
}

export function defaultConfig(schema: Schema): LayerConfig {
  const cfg: LayerConfig = {};
  for (const [key, spec] of Object.entries(schema)) cfg[key] = spec.def;
  return cfg;
}

/** Everything a layer may read while rendering one frame. Deterministic. */
export interface RenderCtx {
  /** Frame index at the project fps. */
  frame: number;
  /** frame / fps, seconds. */
  time: number;
  fps: number;
  w: number;
  h: number;
  features: FeatureTrack;
  audio: AudioSource;
  /** 2D context of the output canvas. Layers draw here. */
  c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** Shared WebGL2 renderer; GL layers render there then blit into c2. */
  glr: GLRenderer;
  theme: ThemeColors;
  /** Transcribed caption track, if any (read by the caption overlay). */
  captions: CaptionTrack | null;
}

export interface Layer {
  render(rc: RenderCtx, cfg: LayerConfig): void;
  dispose?(): void;
}

export type LayerKind = 'background' | 'visualizer' | 'overlay';

/**
 * On-canvas placement of a visualizer instance: center position as a
 * fraction of the frame plus a uniform scale. Applied by the compositor as
 * a 2D transform around the layer's own center — layers keep drawing as if
 * they owned the full frame.
 */
export interface Placement {
  x: number;
  y: number;
  scale: number;
}

export function defaultPlacement(): Placement {
  return { x: 0.5, y: 0.5, scale: 1 };
}

export interface LayerDef {
  /** Stable id, also the i18n key prefix (`layer.<id>`). */
  id: string;
  kind: LayerKind;
  schema: Schema;
  create(): Layer;
}

/**
 * Define a layer from a schema + render function with fully typed config.
 * `state` (optional) is per-instance scratch space for caches (GL buffers,
 * decoded images) — never for anything that affects determinism.
 */
export function defineLayer<S extends Schema, St = void>(def: {
  id: string;
  kind: LayerKind;
  schema: S;
  init?: () => St;
  render: (rc: RenderCtx, cfg: ConfigOf<S>, state: St) => void;
  dispose?: (state: St) => void;
}): LayerDef {
  return {
    id: def.id,
    kind: def.kind,
    schema: def.schema,
    create(): Layer {
      const state = def.init ? def.init() : (undefined as St);
      return {
        render: (rc, cfg) => def.render(rc, cfg as ConfigOf<S>, state),
        dispose: def.dispose ? () => def.dispose!(state) : undefined,
      };
    },
  };
}

/** Resolve a ColorValue against the active theme. */
export function resolveColor(v: ColorValue, theme: ThemeColors): string {
  switch (v) {
    case 'theme:a': return theme.a;
    case 'theme:b': return theme.b;
    case 'theme:c': return theme.c;
    case 'theme:bg': return theme.bg;
    default: return v;
  }
}

/** hex '#rrggbb' → [r,g,b] 0..1 (for shader uniforms). */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** hex + alpha → rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}
