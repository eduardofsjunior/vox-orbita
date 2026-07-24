/**
 * Kaleidoscope mandala: one spectrum-derived petal, mirrored around N
 * symmetry sectors and rotated over time. Beats bloom the whole figure and
 * the spectral centroid tilts the petal shape, so it breathes with the mix.
 *
 * Pure function of (time, per-frame features) — deterministic and seek-safe.
 */

import { bandsAt, beatAt, centroidAt, envAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

const BANDS = 64;

export const visMandala = defineLayer({
  id: 'vis-mandala',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    innerColor: { kind: 'color', def: 'theme:b' },
    tipColor: { kind: 'color', def: 'theme:c' },
    sectors: { kind: 'slider', min: 3, max: 16, step: 1, def: 8 },
    radius: { kind: 'slider', min: 0.02, max: 0.4, step: 0.01, def: 0.12 },
    petalLength: { kind: 'slider', min: 0.1, max: 1, step: 0.01, def: 0.55 },
    rotateSpeed: { kind: 'slider', min: -60, max: 60, step: 1, def: 8, unit: '°/s' },
    counterRotate: { kind: 'toggle', def: false },
    layers: { kind: 'slider', min: 1, max: 4, step: 1, def: 2 },
    beatBloom: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
    thickness: { kind: 'slider', min: 0.5, max: 6, step: 0.25, def: 2 },
    fill: { kind: 'toggle', def: true },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const innerColor = resolveColor(cfg.innerColor, theme);
    const tipColor = resolveColor(cfg.tipColor, theme);
    const minDim = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;

    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);
    const env = envAt(features, frame);
    const centroid = centroidAt(features, frame);

    const sectors = Math.round(cfg.sectors);
    const bloom = 1 + beat * cfg.beatBloom * 0.22;
    const r0 = cfg.radius * minDim * bloom;
    const petal = cfg.petalLength * minDim * 0.86 * (0.75 + env * 0.5);
    const layerCount = Math.round(cfg.layers);

    // Ripple detail along each petal edge (fine spectrum texture).
    const steps = 32;
    const profile = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const b = Math.min(BANDS - 1, Math.round((i / (steps - 1)) * (BANDS - 1)));
      profile[i] = Math.pow(bands[b], 1.4);
    }

    // Each sector gets its own length from a band group, so the flower
    // visibly opens and closes with the spectrum.
    const perSector = new Float32Array(sectors);
    const groupSize = Math.max(1, Math.floor(BANDS / sectors));
    for (let s = 0; s < sectors; s++) {
      let sum = 0;
      for (let i = 0; i < groupSize; i++) sum += bands[Math.min(BANDS - 1, s * groupSize + i)];
      perSector[s] = Math.pow(sum / groupSize, 0.85);
    }

    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, 0.85);
      c2.shadowBlur = cfg.glow * minDim * 0.022;
    }
    c2.lineJoin = 'round';

    for (let layer = 0; layer < layerCount; layer++) {
      const lt = layerCount === 1 ? 0 : layer / (layerCount - 1);
      // Alternate layers spin the other way for a kaleidoscopic shimmer.
      const dir = cfg.counterRotate && layer % 2 === 1 ? -1 : 1;
      // Offset each layer by half a sector: still N-fold symmetric, but
      // the petals interleave instead of stacking.
      const rot = (dir * cfg.rotateSpeed * time * Math.PI) / 180 + (layer % 2) * (Math.PI / sectors);
      const layerScale = 1 - lt * 0.32;
      const alpha = 1 - lt * 0.45;

      for (let s = 0; s < sectors; s++) {
        const a0 = rot + (s / sectors) * Math.PI * 2;
        const halfWidth = (Math.PI / sectors) * (0.34 + centroid * 0.26);
        // Petal length: a solid base plus this sector's spectrum energy.
        const len = petal * (0.32 + perSector[s] * 0.85) * layerScale;

        // Petal outline: out along one edge, back along the mirrored edge.
        const edge = (i: number, side: 1 | -1): [number, number] => {
          const u = i / (steps - 1);
          // Ripple rides on top of the smooth petal so the rim stays lively.
          const r = (r0 * layerScale) + u * len + profile[i] * petal * 0.12 * u * layerScale;
          const a = a0 + side * Math.sin(u * Math.PI) * halfWidth;
          return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        };

        c2.beginPath();
        for (let i = 0; i < steps; i++) {
          const [x, y] = edge(i, -1);
          if (i === 0) c2.moveTo(x, y);
          else c2.lineTo(x, y);
        }
        for (let i = steps - 1; i >= 0; i--) {
          const [x, y] = edge(i, 1);
          c2.lineTo(x, y);
        }
        c2.closePath();

        if (cfg.fill) {
          const grad = c2.createRadialGradient(cx, cy, r0 * layerScale * 0.6, cx, cy, (r0 + petal) * layerScale);
          grad.addColorStop(0, withAlpha(innerColor, 0.32 * alpha));
          grad.addColorStop(1, withAlpha(tipColor, 0.05 * alpha));
          c2.fillStyle = grad;
          c2.fill();
        }
        c2.strokeStyle = withAlpha(layer === 0 ? color : tipColor, alpha * (0.55 + env * 0.45));
        c2.lineWidth = cfg.thickness * layerScale * (minDim / 1080);
        c2.stroke();
      }
    }

    // Core: a small pulsing disc that anchors the figure.
    c2.shadowBlur = 0;
    const coreR = r0 * 0.22 * (0.7 + beat * 0.5);
    const core = c2.createRadialGradient(cx, cy, 0, cx, cy, Math.max(coreR, 1));
    core.addColorStop(0, withAlpha(tipColor, 0.95));
    core.addColorStop(1, withAlpha(innerColor, 0));
    c2.fillStyle = core;
    c2.beginPath();
    c2.arc(cx, cy, Math.max(coreR, 1), 0, Math.PI * 2);
    c2.fill();
  },
});
