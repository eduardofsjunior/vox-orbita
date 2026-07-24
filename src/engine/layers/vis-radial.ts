/**
 * Radial spectrum: bars around a circle + inner pulse ring with beat kick.
 */

import { bandsAt, beatAt, rmsAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

export const visRadial = defineLayer({
  id: 'vis-radial',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    ringColor: { kind: 'color', def: 'theme:b' },
    radius: { kind: 'slider', min: 0.1, max: 0.45, step: 0.01, def: 0.24 },
    barLength: { kind: 'slider', min: 0.1, max: 1, step: 0.01, def: 0.55 },
    thickness: { kind: 'slider', min: 1, max: 12, step: 0.5, def: 4 },
    rotateSpeed: { kind: 'slider', min: -30, max: 30, step: 1, def: 4, unit: '°/s' },
    beatKick: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
    mirror: { kind: 'toggle', def: true },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const ringColor = resolveColor(cfg.ringColor, theme);
    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);
    const rms = rmsAt(features, frame);

    const minDim = Math.min(w, h);
    const kick = cfg.beatKick * beat;
    const r0 = cfg.radius * minDim * (1 + kick * 0.06);
    const maxLen = cfg.barLength * minDim * 0.32;
    const rot = (cfg.rotateSpeed * time * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;

    c2.lineCap = 'round';
    c2.lineWidth = (cfg.thickness * minDim) / 1080;
    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, Math.min(1, cfg.glow));
      c2.shadowBlur = cfg.glow * minDim * 0.02;
    }

    c2.strokeStyle = color;
    c2.beginPath();
    const total = 64;
    for (let i = 0; i < total; i++) {
      // Mirrored mode folds the spectrum so lows meet at top and bottom.
      const band = cfg.mirror ? (i < 32 ? i * 2 : (total - 1 - i) * 2 + 1) : i;
      const v = bands[Math.min(63, band)];
      const angle = rot - Math.PI / 2 + (i / total) * Math.PI * 2;
      const len = Math.max(2, Math.pow(v, 1.6) * maxLen * (1 + kick * 0.5));
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      c2.moveTo(cx + cos * r0, cy + sin * r0);
      c2.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    }
    c2.stroke();

    // Inner pulse ring: radius breathes with RMS, opacity kicks on beats.
    const ringR = r0 * (0.72 + rms * 0.1 + kick * 0.08);
    c2.shadowBlur = cfg.glow * minDim * 0.03;
    c2.shadowColor = withAlpha(ringColor, 0.9);
    c2.strokeStyle = withAlpha(ringColor, 0.45 + beat * 0.55);
    c2.lineWidth = (2 + beat * 5) * (minDim / 1080);
    c2.beginPath();
    c2.arc(cx, cy, ringR, 0, Math.PI * 2);
    c2.stroke();
    c2.shadowBlur = 0;
  },
});
