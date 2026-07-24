/**
 * Compositor: renders one frame of the layer stack onto a canvas.
 *
 * Deterministic: `renderFrame(n)` depends only on (n, configs, features,
 * audio, theme, size). The preview loop and the exporter both call this —
 * that is the whole determinism guarantee.
 */

import type { AudioSource, FeatureTrack, ThemeColors } from './types';
import type { CaptionTrack } from './captions';
import { GLRenderer } from './gl';
import { type Layer, type LayerConfig, type LayerDef, type Placement, type RenderCtx } from './layers/api';

export interface StackEntry {
  def: LayerDef;
  config: LayerConfig;
  enabled: boolean;
  /** Optional placement transform (visualizer instances). */
  placement?: Placement;
  /** Per-scope palette override; falls back to the compositor theme. */
  theme?: ThemeColors;
}

export class Compositor {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private glr: GLRenderer;
  private instances = new Map<string, Layer>();

  features: FeatureTrack | null = null;
  audio: AudioSource | null = null;
  captions: CaptionTrack | null = null;
  theme: ThemeColors;
  fps = 30;
  stack: StackEntry[] = [];

  private warnedLayers = new Set<string>();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, theme: ThemeColors) {
    this.canvas = canvas;
    const c2 = canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c2) throw new Error('2D canvas context unavailable');
    this.c2 = c2;
    this.glr = new GLRenderer();
    this.theme = theme;
  }

  /**
   * Recover from GPU context loss: throw away the GL renderer and all layer
   * instances (their GL resources died with the context) and start fresh.
   */
  private resetGL(): void {
    for (const layer of this.instances.values()) layer.dispose?.();
    this.instances.clear();
    try {
      this.glr.dispose();
    } catch {
      // The context is already gone; nothing to release.
    }
    try {
      this.glr = new GLRenderer();
      this.glr.resize(this.canvas.width, this.canvas.height);
      this.warnedLayers.clear();
    } catch {
      // GPU still unavailable — keep the lost context; GL layers will skip
      // (caught per-layer below) and 2D layers keep rendering.
    }
  }

  setSize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.glr.resize(w, h);
  }

  /** Render frame `n` of the current stack. Safe to call with no audio. */
  renderFrame(frame: number): void {
    const { c2 } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    c2.save();
    c2.fillStyle = this.theme.bg;
    c2.fillRect(0, 0, w, h);

    if (this.features && this.audio) {
      if (this.glr.isContextLost()) this.resetGL();
      const rc: RenderCtx = {
        frame,
        time: frame / this.fps,
        fps: this.fps,
        w,
        h,
        features: this.features,
        audio: this.audio,
        c2,
        glr: this.glr,
        theme: this.theme,
        captions: this.captions,
      };
      for (const entry of this.stack) {
        if (!entry.enabled) continue;
        const layer = this.instance(entry.def);
        // Each layer renders with its own scope palette when one is set.
        rc.theme = entry.theme ?? this.theme;
        c2.save();
        try {
          const p = entry.placement;
          if (p && (p.x !== 0.5 || p.y !== 0.5 || p.scale !== 1)) {
            // Move the layer's center to (x, y) and scale about that point.
            c2.translate(p.x * w, p.y * h);
            c2.scale(p.scale, p.scale);
            c2.translate(-w / 2, -h / 2);
          }
          layer.render(rc, entry.config);
        } catch (err) {
          // One bad layer (e.g. shader failure after context loss) must not
          // take down the whole frame or the render loop.
          if (!this.warnedLayers.has(entry.def.id)) {
            this.warnedLayers.add(entry.def.id);
            console.warn(`[voxorbita] layer "${entry.def.id}" failed to render:`, err);
          }
        } finally {
          c2.restore();
        }
      }
    }
    c2.restore();
  }

  private instance(def: LayerDef): Layer {
    let layer = this.instances.get(def.id);
    if (!layer) {
      layer = def.create();
      this.instances.set(def.id, layer);
    }
    return layer;
  }

  dispose(): void {
    for (const layer of this.instances.values()) layer.dispose?.();
    this.instances.clear();
    this.glr.dispose();
  }
}
