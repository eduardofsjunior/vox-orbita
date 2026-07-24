/**
 * Spectrum tunnel: concentric rings, each one a *past* spectrum frame,
 * expanding outward as it ages so you appear to fly through the sound.
 *
 * History comes straight from the FeatureTrack (frame − k·stride), so the
 * whole effect is a pure function of the current frame — no accumulation,
 * and seeking lands on exactly the same image as playing there.
 */

import { bandsAt, beatAt, centroidAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

const BANDS = 64;

export const visTunnel = defineLayer({
  id: 'vis-tunnel',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    farColor: { kind: 'color', def: 'theme:b' },
    rings: { kind: 'slider', min: 8, max: 48, step: 1, def: 26 },
    stride: { kind: 'slider', min: 1, max: 6, step: 1, def: 2, unit: 'f' },
    depth: { kind: 'slider', min: 0.6, max: 3, step: 0.05, def: 1.5 },
    amplitude: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
    rotateSpeed: { kind: 'slider', min: -60, max: 60, step: 1, def: 10, unit: '°/s' },
    twist: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
    thickness: { kind: 'slider', min: 0.5, max: 6, step: 0.25, def: 1.75 },
    spokes: { kind: 'toggle', def: true },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const farColor = resolveColor(cfg.farColor, theme);
    const minDim = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const beat = beatAt(features, frame);
    const centroid = centroidAt(features, frame);

    const ringCount = Math.round(cfg.rings);
    const maxR = minDim * 0.62 * (1 + beat * 0.05);
    const amp = cfg.amplitude * minDim * 0.16;
    const baseRot = (cfg.rotateSpeed * time * Math.PI) / 180;

    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, 0.8);
      c2.shadowBlur = cfg.glow * minDim * 0.02;
    }
    c2.lineJoin = 'round';

    // Keep a copy of the nearest ring's radii so spokes can join the rings.
    const prevPts = new Float32Array(BANDS * 2);
    const curPts = new Float32Array(BANDS * 2);
    let havePrev = false;

    // Draw far → near so nearer rings sit on top.
    for (let k = ringCount - 1; k >= 0; k--) {
      const t = k / ringCount; // 0 = newest (nearest, largest), 1 = oldest (vanishing point)
      const bands = bandsAt(features, frame - k * cfg.stride);
      // True perspective: the newest ring is closest and biggest, older ones
      // recede toward a vanishing point and bunch up as they go.
      const baseR = maxR * Math.pow(1 - t, cfg.depth);
      // Each ring is twisted a little more than the one in front of it.
      const rot = baseRot + t * cfg.twist * Math.PI * 2;
      const fade = (1 - t) * 0.85 + 0.15;

      for (let b = 0; b < BANDS; b++) {
        const angle = rot + (b / BANDS) * Math.PI * 2;
        const v = bands[b];
        // Nearer rings show more spectrum detail; distant ones flatten out.
        const r = baseR + Math.pow(v, 1.4) * amp * (0.3 + (1 - t));
        curPts[b * 2] = cx + Math.cos(angle) * r;
        curPts[b * 2 + 1] = cy + Math.sin(angle) * r;
      }

      // Ring outline, tinted from near colour to far colour with depth.
      c2.strokeStyle = withAlpha(t < 0.5 ? color : farColor, fade * (0.55 + centroid * 0.45));
      c2.lineWidth = cfg.thickness * (1 - t * 0.6) * (minDim / 1080);
      c2.beginPath();
      for (let b = 0; b <= BANDS; b++) {
        const i = (b % BANDS) * 2;
        if (b === 0) c2.moveTo(curPts[i], curPts[i + 1]);
        else c2.lineTo(curPts[i], curPts[i + 1]);
      }
      c2.closePath();
      c2.stroke();

      // Longitudinal spokes tie consecutive rings into a tube.
      if (cfg.spokes && havePrev) {
        c2.strokeStyle = withAlpha(farColor, fade * 0.14);
        c2.lineWidth = cfg.thickness * 0.5 * (minDim / 1080);
        c2.beginPath();
        for (let b = 0; b < BANDS; b += 4) {
          c2.moveTo(prevPts[b * 2], prevPts[b * 2 + 1]);
          c2.lineTo(curPts[b * 2], curPts[b * 2 + 1]);
        }
        c2.stroke();
      }
      prevPts.set(curPts);
      havePrev = true;
    }

    c2.shadowBlur = 0;
  },
});
