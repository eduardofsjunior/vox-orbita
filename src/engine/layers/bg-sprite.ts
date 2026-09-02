/**
 * Animated sprite-sheet background — the home for hand-made or AI-generated
 * pixel-art loops.
 *
 * You supply ONE image containing a grid of frames (left→right, top→bottom).
 * The layer plays them as a loop, either on its own clock or stepping one
 * frame per detected beat. Nearest-neighbour sampling is on by default so
 * pixel art stays crisp instead of turning to mush when scaled to 4K.
 *
 * Deterministic: the frame index is a pure function of `rc.time` (or of the
 * onset count up to `rc.frame`), so preview and export match exactly.
 *
 * Sheets come in two flavours, which is what `sheetFormat` selects:
 *
 * **Format A** — cels tile the bitmap edge to edge with no border and no gutters,
 * so each cel is exactly `1/cols × 1/rows`. Hand-made sheets look like this.
 *
 * **Format B** — the "contact sheet" look image models produce by default: a
 * border around the whole grid plus thin divider lines between cels. Slicing
 * that by exact even division catches the divider along each cel's top and left
 * edge — and because the model's grid is usually a few pixels out of true, a
 * sliver of the neighbouring cel comes with it. Format B trims `trim` off every
 * side so only the cel interior is sampled.
 */

import { beatAt, envAt, onsetCountAt, rmsAt } from '../types';
import { defineLayer, resolveColor } from './api';

/** Source rectangle of one cel, in bitmap pixels. */
export interface CelRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Where cel `index` lives in the sheet. `trim` is the fraction of the cel to cut
 * from each side (0 = Format A's exact even division).
 *
 * Pure and side-effect free so the geometry stays testable and preview/export
 * can never disagree.
 */
export function celRect(
  width: number,
  height: number,
  cols: number,
  rows: number,
  index: number,
  trim = 0,
): CelRect {
  const cw = width / cols;
  const ch = height / rows;
  // Keep at least one pixel even if someone drags trim to the top of its range
  // on a tiny sheet.
  const insetX = Math.min(cw * trim, (cw - 1) / 2);
  const insetY = Math.min(ch * trim, (ch - 1) / 2);
  return {
    sx: (index % cols) * cw + insetX,
    sy: Math.floor(index / cols) * ch + insetY,
    sw: cw - insetX * 2,
    sh: ch - insetY * 2,
  };
}

export const bgSprite = defineLayer({
  id: 'bg-sprite',
  kind: 'background',
  schema: {
    image: { kind: 'image', def: null },
    columns: { kind: 'slider', min: 1, max: 12, step: 1, def: 4 },
    rows: { kind: 'slider', min: 1, max: 12, step: 1, def: 3 },
    frames: { kind: 'slider', min: 1, max: 64, step: 1, def: 12 },
    frameRate: { kind: 'slider', min: 1, max: 24, step: 1, def: 10, unit: 'fps' },
    // Format A is the default so existing projects keep slicing exactly as before.
    sheetFormat: { kind: 'select', options: ['formatA', 'formatB'], def: 'formatA' },
    // Only read in Format B. 6% clears the divider bands plus the few pixels of
    // grid skew typical of a generated sheet; push it higher for a sheet whose
    // grid sits noticeably off-centre.
    trim: { kind: 'slider', min: 0, max: 0.2, step: 0.005, def: 0.06 },
    advance: { kind: 'select', options: ['time', 'beat', 'energy'], def: 'time' },
    fit: { kind: 'select', options: ['cover', 'contain'], def: 'cover' },
    pixelated: { kind: 'toggle', def: true },
    zoom: { kind: 'slider', min: 1, max: 2, step: 0.01, def: 1 },
    reactiveZoom: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.2 },
    dim: { kind: 'slider', min: 0, max: 0.9, step: 0.01, def: 0.15 },
    base: { kind: 'color', def: 'theme:bg' },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, time, theme } = rc;
    c2.fillStyle = resolveColor(cfg.base, theme);
    c2.fillRect(0, 0, w, h);

    const img = cfg.image;
    if (!img) return;

    const cols = Math.max(1, Math.round(cfg.columns));
    const rows = Math.max(1, Math.round(cfg.rows));
    const total = Math.max(1, Math.min(Math.round(cfg.frames), cols * rows));

    // Pick the current cel.
    let index: number;
    if (cfg.advance === 'beat') {
      // One frame per onset — the loop dances with the track.
      index = onsetCountAt(features, frame) % total;
    } else if (cfg.advance === 'energy') {
      // Playback rate rises with loudness (idle → frantic).
      const rate = cfg.frameRate * (0.35 + rmsAt(features, frame) * 1.6);
      index = Math.floor(time * rate) % total;
    } else {
      index = Math.floor(time * cfg.frameRate) % total;
    }

    const trim = cfg.sheetFormat === 'formatB' ? cfg.trim : 0;
    const { sx, sy, sw, sh } = celRect(
      img.bitmap.width,
      img.bitmap.height,
      cols,
      rows,
      index,
      trim,
    );

    // Fit the cel to the frame, with optional audio-reactive push-in.
    const beat = beatAt(features, frame);
    const env = envAt(features, frame);
    const zoom = cfg.zoom * (1 + cfg.reactiveZoom * (env * 0.05 + beat * 0.05));
    const scale =
      (cfg.fit === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh)) * zoom;
    const dw = sw * scale;
    const dh = sh * scale;

    const smoothing = c2.imageSmoothingEnabled;
    // Nearest-neighbour keeps pixel art sharp at any output resolution.
    c2.imageSmoothingEnabled = !cfg.pixelated;
    c2.drawImage(img.bitmap, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
    c2.imageSmoothingEnabled = smoothing;

    if (cfg.dim > 0) {
      c2.fillStyle = `rgba(0,0,0,${cfg.dim})`;
      c2.fillRect(0, 0, w, h);
    }
  },
});
