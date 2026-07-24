/**
 * Waterfall ridgeline: a stack of spectrum traces marching back in time —
 * the "unknown pleasures" plot. The newest spectrum is at the front and
 * older frames recede upward, each filled with the background colour so it
 * occludes the ones behind it (painter's algorithm).
 *
 * Reads history from the FeatureTrack, so it is stateless and seek-exact.
 */

import { bandsAt, beatAt, rmsAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

const BANDS = 64;
const POINTS = 128; // interpolated across the bands for a smooth ridge

export const visRidgeline = defineLayer({
  id: 'vis-ridgeline',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    farColor: { kind: 'color', def: 'theme:b' },
    fillColor: { kind: 'color', def: 'theme:bg' },
    lines: { kind: 'slider', min: 8, max: 60, step: 1, def: 34 },
    stride: { kind: 'slider', min: 1, max: 6, step: 1, def: 2, unit: 'f' },
    amplitude: { kind: 'slider', min: 0.05, max: 1, step: 0.01, def: 0.42 },
    spread: { kind: 'slider', min: 0.2, max: 1, step: 0.01, def: 0.62 },
    perspective: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
    widthFrac: { kind: 'slider', min: 0.3, max: 1, step: 0.01, def: 0.8 },
    thickness: { kind: 'slider', min: 0.5, max: 5, step: 0.25, def: 1.75 },
    occlude: { kind: 'toggle', def: true },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const farColor = resolveColor(cfg.farColor, theme);
    const fillColor = resolveColor(cfg.fillColor, theme);
    const minDim = Math.min(w, h);
    const beat = beatAt(features, frame);
    const rms = rmsAt(features, frame);

    const lineCount = Math.round(cfg.lines);
    const amp = cfg.amplitude * h * 0.34 * (1 + beat * 0.12);
    const stackH = h * cfg.spread;
    const baseY = h * 0.5 + stackH * 0.5;

    c2.lineJoin = 'round';
    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, 0.75);
      c2.shadowBlur = cfg.glow * minDim * 0.014;
    }

    // Back (oldest) → front (newest) so nearer ridges cover farther ones.
    for (let k = lineCount - 1; k >= 0; k--) {
      const t = k / lineCount; // 0 = newest/front, 1 = oldest/back
      const bands = bandsAt(features, frame - k * cfg.stride);
      // Rows bunch toward the horizon and narrow with distance.
      const depth = Math.pow(t, 1 + cfg.perspective);
      const y0 = baseY - depth * stackH;
      const shrink = 1 - cfg.perspective * t * 0.45;
      const rowW = w * cfg.widthFrac * shrink;
      const x0 = (w - rowW) / 2;
      const rowAmp = amp * (1 - t * 0.35);

      c2.beginPath();
      for (let p = 0; p < POINTS; p++) {
        const f = (p / (POINTS - 1)) * (BANDS - 1);
        const i = Math.floor(f);
        const frac = f - i;
        const v = bands[i] * (1 - frac) + bands[Math.min(BANDS - 1, i + 1)] * frac;
        // Taper the ends so ridges sit on the baseline instead of clipping.
        const taper = Math.sin((p / (POINTS - 1)) * Math.PI);
        const x = x0 + (p / (POINTS - 1)) * rowW;
        const y = y0 - Math.pow(v, 1.5) * rowAmp * taper;
        if (p === 0) c2.moveTo(x, y);
        else c2.lineTo(x, y);
      }

      if (cfg.occlude) {
        // Close down to the row baseline and fill to hide the rows behind.
        c2.lineTo(x0 + rowW, y0);
        c2.lineTo(x0, y0);
        c2.closePath();
        const shade = c2.createLinearGradient(0, y0 - rowAmp, 0, y0);
        shade.addColorStop(0, withAlpha(fillColor, 0.92));
        shade.addColorStop(1, withAlpha(fillColor, 0.99));
        c2.fillStyle = shade;
        const prevShadow = c2.shadowBlur;
        c2.shadowBlur = 0;
        c2.fill();
        c2.shadowBlur = prevShadow;
      }

      // Nearer rows are brighter and use the near colour.
      const mix = t;
      c2.strokeStyle = withAlpha(mix < 0.5 ? color : farColor, (1 - t) * (0.5 + rms * 0.5) + 0.12);
      c2.lineWidth = cfg.thickness * (1 - t * 0.5) * (minDim / 1080);
      c2.stroke();
    }
    c2.shadowBlur = 0;
  },
});
