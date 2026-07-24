/**
 * Linear spectrum: vertical bars across the frame, optional mirrored mode.
 */

import { bandsAt, beatAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

export const visLinear = defineLayer({
  id: 'vis-linear',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    tipColor: { kind: 'color', def: 'theme:c' },
    mirrored: { kind: 'toggle', def: true },
    heightScale: { kind: 'slider', min: 0.1, max: 1, step: 0.01, def: 0.6 },
    barGap: { kind: 'slider', min: 0, max: 0.8, step: 0.01, def: 0.35 },
    baseline: { kind: 'slider', min: 0.1, max: 0.9, step: 0.01, def: 0.5 },
    widthFrac: { kind: 'slider', min: 0.4, max: 1, step: 0.01, def: 0.82 },
    rounded: { kind: 'toggle', def: true },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
    beatKick: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, theme } = rc;
    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);
    const color = resolveColor(cfg.color, theme);
    const tipColor = resolveColor(cfg.tipColor, theme);

    const n = 64;
    const totalW = w * cfg.widthFrac;
    const x0 = (w - totalW) / 2;
    const slot = totalW / n;
    const barW = Math.max(1, slot * (1 - cfg.barGap));
    const maxH = h * cfg.heightScale * 0.5 * (1 + cfg.beatKick * beat * 0.35);
    const baseY = h * cfg.baseline;
    const radius = cfg.rounded ? Math.min(barW / 2, 6 * (Math.min(w, h) / 1080)) : 0;

    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, Math.min(1, cfg.glow * 0.9));
      c2.shadowBlur = cfg.glow * Math.min(w, h) * 0.018;
    }

    const grad = c2.createLinearGradient(0, baseY - maxH, 0, baseY + (cfg.mirrored ? maxH : 0));
    grad.addColorStop(0, tipColor);
    grad.addColorStop(cfg.mirrored ? 0.5 : 1, color);
    if (cfg.mirrored) grad.addColorStop(1, tipColor);
    c2.fillStyle = grad;

    c2.beginPath();
    for (let i = 0; i < n; i++) {
      const v = bands[i];
      const bh = Math.max(2, Math.pow(v, 1.6) * maxH);
      const x = x0 + i * slot + (slot - barW) / 2;
      if (cfg.mirrored) {
        roundRectPath(c2, x, baseY - bh, barW, bh * 2, radius);
      } else {
        roundRectPath(c2, x, baseY - bh, barW, bh, radius);
      }
    }
    c2.fill();
    c2.shadowBlur = 0;
  },
});

function roundRectPath(
  c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r <= 0) {
    c2.rect(x, y, w, h);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  c2.moveTo(x + rr, y);
  c2.arcTo(x + w, y, x + w, y + h, rr);
  c2.arcTo(x + w, y + h, x, y + h, rr);
  c2.arcTo(x, y + h, x, y, rr);
  c2.arcTo(x, y, x + w, y, rr);
  c2.closePath();
}
