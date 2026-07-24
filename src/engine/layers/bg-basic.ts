/**
 * Basic backgrounds: solid color and user-uploaded image with optional
 * audio-reactive blur/zoom.
 */

import { beatAt, rmsAt } from '../types';
import { defineLayer, resolveColor } from './api';

export const bgSolid = defineLayer({
  id: 'bg-solid',
  kind: 'background',
  schema: {
    color: { kind: 'color', def: 'theme:bg' },
    vignette: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
  },
  render(rc, cfg) {
    const { c2, w, h, theme } = rc;
    c2.fillStyle = resolveColor(cfg.color, theme);
    c2.fillRect(0, 0, w, h);
    if (cfg.vignette > 0) {
      const g = c2.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${cfg.vignette * 0.55})`);
      c2.fillStyle = g;
      c2.fillRect(0, 0, w, h);
    }
  },
});

export const bgImage = defineLayer({
  id: 'bg-image',
  kind: 'background',
  schema: {
    image: { kind: 'image', def: null },
    dim: { kind: 'slider', min: 0, max: 0.9, step: 0.01, def: 0.45 },
    blur: { kind: 'slider', min: 0, max: 40, step: 1, def: 0, unit: 'px' },
    reactiveZoom: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
    reactiveBlur: { kind: 'toggle', def: false },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, theme } = rc;
    c2.fillStyle = theme.bg;
    c2.fillRect(0, 0, w, h);
    const img = cfg.image;
    if (!img) return;

    const rms = rmsAt(features, frame);
    const beat = beatAt(features, frame);
    const zoom = 1 + cfg.reactiveZoom * (rms * 0.05 + beat * 0.04);
    const scale = Math.max(w / img.bitmap.width, h / img.bitmap.height) * zoom;
    const dw = img.bitmap.width * scale;
    const dh = img.bitmap.height * scale;

    const blurPx = cfg.blur + (cfg.reactiveBlur ? beat * 14 : 0);
    if (blurPx > 0.5) c2.filter = `blur(${(blurPx * Math.min(w, h)) / 1080}px)`;
    c2.drawImage(img.bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
    c2.filter = 'none';

    if (cfg.dim > 0) {
      c2.fillStyle = `rgba(0,0,0,${cfg.dim})`;
      c2.fillRect(0, 0, w, h);
    }
  },
});
