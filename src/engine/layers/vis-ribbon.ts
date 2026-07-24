/**
 * Waveform ribbon: a smooth amplitude path sweeping the frame, with a glow
 * trail built from earlier frames (stateless — the trail re-reads history,
 * so seeking stays deterministic).
 */

import { envAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

export const visRibbon = defineLayer({
  id: 'vis-ribbon',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    glowColor: { kind: 'color', def: 'theme:b' },
    amplitude: { kind: 'slider', min: 0.05, max: 0.5, step: 0.01, def: 0.22 },
    window: { kind: 'slider', min: 0.5, max: 6, step: 0.1, def: 2.4, unit: 's' },
    thickness: { kind: 'slider', min: 1, max: 10, step: 0.5, def: 3 },
    trail: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.6 },
    smoothness: { kind: 'slider', min: 0, max: 6, step: 1, def: 2 },
    fill: { kind: 'toggle', def: true },
    centerY: { kind: 'slider', min: 0.2, max: 0.8, step: 0.01, def: 0.5 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, audio, frame, fps, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const glowColor = resolveColor(cfg.glowColor, theme);
    const minDim = Math.min(w, h);
    const cy = h * cfg.centerY;
    const amp = h * cfg.amplitude;
    const points = 220;
    const windowSamples = cfg.window * audio.sampleRate;
    const endSample = (frame / fps) * audio.sampleRate;
    const mono = audio.mono;

    // Amplitude envelope across the window: peak |sample| per x-slice.
    // Always positive — the old signed-peak approach flipped sign almost
    // randomly between frames and made the ribbon flicker violently.
    const ys = new Float32Array(points);
    for (let p = 0; p < points; p++) {
      const s0 = Math.round(endSample - windowSamples + (p / points) * windowSamples);
      const s1 = Math.round(s0 + windowSamples / points);
      let peak = 0;
      for (let i = Math.max(0, s0); i < Math.min(mono.length, s1); i++) {
        const a = Math.abs(mono[i]);
        if (a > peak) peak = a;
      }
      ys[p] = peak;
    }
    // User-controlled smoothing: 0 = raw and spiky, 6 = silky swell.
    for (let pass = 0; pass < cfg.smoothness; pass++) {
      for (let p = 1; p < points - 1; p++) {
        ys[p] = (ys[p - 1] + ys[p] * 2 + ys[p + 1]) / 4;
      }
    }

    const yScale = amp * 2.1;
    // Symmetric ribbon band: upper edge left→right, lower edge right→left.
    const bandPath = (scale: number) => {
      c2.beginPath();
      for (let p = 0; p < points; p++) {
        const x = (p / (points - 1)) * w;
        const y = cy - Math.max(ys[p] * yScale * scale, 1);
        if (p === 0) c2.moveTo(x, y);
        else c2.lineTo(x, y);
      }
      for (let p = points - 1; p >= 0; p--) {
        c2.lineTo((p / (points - 1)) * w, cy + Math.max(ys[p] * yScale * scale, 1));
      }
      c2.closePath();
    };

    // Glow trail: slightly swollen echoes of the band, breathing with the
    // recent envelope, at decreasing opacity.
    if (cfg.trail > 0) {
      const echoes = 4;
      for (let e = echoes; e >= 1; e--) {
        const pastEnv = envAt(features, frame - e * 3);
        const alpha = cfg.trail * 0.14 * (1 - e / (echoes + 1));
        c2.strokeStyle = withAlpha(glowColor, alpha);
        c2.lineWidth = (cfg.thickness + e * 3) * (minDim / 1080);
        c2.lineJoin = 'round';
        bandPath(1 + e * 0.09 * (0.4 + pastEnv));
        c2.stroke();
      }
    }

    if (cfg.fill) {
      bandPath(1);
      const grad = c2.createLinearGradient(0, cy - amp, 0, cy + amp);
      grad.addColorStop(0, withAlpha(color, 0.30));
      grad.addColorStop(0.5, withAlpha(color, 0.10));
      grad.addColorStop(1, withAlpha(color, 0.30));
      c2.fillStyle = grad;
      c2.fill();
    }

    c2.shadowColor = withAlpha(glowColor, 0.8);
    c2.shadowBlur = minDim * 0.012;
    c2.strokeStyle = color;
    c2.lineWidth = cfg.thickness * (minDim / 1080);
    c2.lineJoin = 'round';
    bandPath(1);
    c2.stroke();
    c2.shadowBlur = 0;
  },
});
