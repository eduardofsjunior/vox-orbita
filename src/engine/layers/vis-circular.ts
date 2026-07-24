/**
 * Circular waveform: the recent waveform wrapped around a slowly rotating
 * circle, with optional beat-reactive radius.
 */

import { beatAt, rmsAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

export const visCircular = defineLayer({
  id: 'vis-circular',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    innerColor: { kind: 'color', def: 'theme:b' },
    radius: { kind: 'slider', min: 0.12, max: 0.42, step: 0.01, def: 0.26 },
    amplitude: { kind: 'slider', min: 0.05, max: 1, step: 0.01, def: 0.42 },
    window: { kind: 'slider', min: 0.2, max: 3, step: 0.05, def: 1.1, unit: 's' },
    rotateSpeed: { kind: 'slider', min: -40, max: 40, step: 1, def: 8, unit: '°/s' },
    thickness: { kind: 'slider', min: 1, max: 8, step: 0.5, def: 2.5 },
    beatPulse: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
    smoothness: { kind: 'slider', min: 0, max: 6, step: 1, def: 2 },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.55 },
  },
  render(rc, cfg) {
    const { c2, w, h, audio, features, frame, fps, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const innerColor = resolveColor(cfg.innerColor, theme);
    const minDim = Math.min(w, h);
    const beat = beatAt(features, frame);
    const rms = rmsAt(features, frame);
    const cx = w / 2;
    const cy = h / 2;
    const baseR = cfg.radius * minDim * (1 + beat * cfg.beatPulse * 0.08);
    const amp = cfg.amplitude * minDim * 0.16;
    const rot = ((cfg.rotateSpeed * time) * Math.PI) / 180;

    const mono = audio.mono;
    const windowSamples = Math.round(cfg.window * audio.sampleRate);
    const end = Math.min(mono.length, Math.round((frame / fps) * audio.sampleRate));
    const start = Math.max(0, end - windowSamples);
    const points = 360;

    // Average each angular slice so the loop closes cleanly.
    const vals = new Float32Array(points);
    if (end > start) {
      const per = (end - start) / points;
      for (let p = 0; p < points; p++) {
        const s0 = Math.floor(start + p * per);
        const s1 = Math.max(s0 + 1, Math.floor(start + (p + 1) * per));
        let peak = 0;
        for (let i = s0; i < s1; i++) {
          const a = Math.abs(mono[i]);
          if (a > peak) peak = a;
        }
        vals[p] = peak;
      }
      for (let pass = 0; pass < cfg.smoothness; pass++) {
        for (let p = 0; p < points; p++) {
          const prev = vals[(p + points - 1) % points];
          const next = vals[(p + 1) % points];
          vals[p] = (prev + vals[p] * 2 + next) / 4;
        }
      }
    }

    const path = (scale: number, inward: boolean) => {
      c2.beginPath();
      for (let p = 0; p <= points; p++) {
        const i = p % points;
        const angle = rot + (p / points) * Math.PI * 2;
        const r = baseR + (inward ? -1 : 1) * vals[i] * amp * scale;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (p === 0) c2.moveTo(x, y);
        else c2.lineTo(x, y);
      }
      c2.closePath();
    };

    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(color, 0.85);
      c2.shadowBlur = cfg.glow * minDim * 0.022;
    }

    // Inner mirrored trace, dimmer.
    c2.strokeStyle = withAlpha(innerColor, 0.5);
    c2.lineWidth = cfg.thickness * 0.7 * (minDim / 1080);
    path(0.62, true);
    c2.stroke();

    // Main outer trace.
    c2.strokeStyle = color;
    c2.lineWidth = cfg.thickness * (minDim / 1080);
    c2.lineJoin = 'round';
    path(1, false);
    c2.stroke();

    // Soft center dot breathing with RMS.
    c2.shadowBlur = 0;
    const dotR = baseR * 0.1 * (0.6 + rms);
    const grad = c2.createRadialGradient(cx, cy, 0, cx, cy, Math.max(dotR, 1));
    grad.addColorStop(0, withAlpha(innerColor, 0.9));
    grad.addColorStop(1, withAlpha(innerColor, 0));
    c2.fillStyle = grad;
    c2.beginPath();
    c2.arc(cx, cy, Math.max(dotR, 1), 0, Math.PI * 2);
    c2.fill();
  },
});
