/**
 * Oscilloscope: Lissajous-style figures traced from the raw stereo waveform
 * (X = left, Y = right; mono input plays against a delayed copy of itself).
 *
 * Motion is layered on top of the trace: continuous rotation, a beat-driven
 * spin kick, a breathing scale and an optional phase skew that opens/closes
 * the figure. All of it is a closed-form function of `rc.time` and the
 * per-frame FeatureTrack, so seeking stays exact.
 */

import { beatAt, envAt, rmsAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

export const visScope = defineLayer({
  id: 'vis-scope',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    echoColor: { kind: 'color', def: 'theme:b' },
    window: { kind: 'slider', min: 10, max: 200, step: 1, def: 70, unit: 'ms' },
    size: { kind: 'slider', min: 0.2, max: 1, step: 0.01, def: 0.62 },
    thickness: { kind: 'slider', min: 0.5, max: 6, step: 0.25, def: 1.75 },
    echo: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.55 },
    beatZoom: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
    rotateSpeed: { kind: 'slider', min: -90, max: 90, step: 1, def: 12, unit: '°/s' },
    beatSpin: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
    phaseSkew: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.25 },
    breathe: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.3 },
    trailSpin: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
  },
  render(rc, cfg) {
    const { c2, w, h, audio, features, frame, fps, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const echoColor = resolveColor(cfg.echoColor, theme);
    const minDim = Math.min(w, h);
    const beat = beatAt(features, frame);
    const env = envAt(features, frame);
    const rms = rmsAt(features, frame);
    const cx = w / 2;
    const cy = h / 2;

    // Scale breathes with the envelope and kicks on beats.
    const breathe = 1 + cfg.breathe * (env - 0.4) * 0.35;
    const scale = minDim * 0.5 * cfg.size * breathe * (1 + beat * cfg.beatZoom * 0.25);

    // Rotation = steady spin + an exponentially decaying kick on each beat.
    const baseRot = (cfg.rotateSpeed * time * Math.PI) / 180;
    const spinKick = beat * cfg.beatSpin * 0.9;

    const chL = audio.channels[0];
    const chR = audio.channels.length > 1 ? audio.channels[1] : chL;
    // Mono fallback: plot against a slightly delayed copy so the figure opens.
    const baseDelay = audio.channels.length > 1 ? 0 : Math.round(audio.sampleRate * 0.006);
    // Phase skew slowly wanders, morphing the Lissajous shape over time.
    const skew = Math.round(
      cfg.phaseSkew * audio.sampleRate * 0.004 * (1 + Math.sin(time * 0.37)) * (0.5 + rms),
    );
    const delay = baseDelay + skew;

    const windowSamples = Math.round((cfg.window / 1000) * audio.sampleRate);
    const end = Math.min(chL.length, Math.round((frame / fps) * audio.sampleRate));
    const start = Math.max(0, end - windowSamples);
    if (end <= start) return;
    const step = Math.max(1, Math.floor(windowSamples / 900));

    const trace = (offset: number, rot: number, col: string, lw: number, alpha: number) => {
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      c2.strokeStyle = withAlpha(col, alpha);
      c2.lineWidth = lw * (minDim / 1080);
      c2.lineJoin = 'round';
      c2.beginPath();
      let first = true;
      for (let i = start; i < end; i += step) {
        const iL = Math.max(0, i - offset);
        const iR = Math.max(0, i - offset - delay);
        const px = chL[iL] * scale;
        const py = -chR[iR] * scale;
        // Rotate the figure in place.
        const x = cx + px * cos - py * sin;
        const y = cy + px * sin + py * cos;
        if (first) {
          c2.moveTo(x, y);
          first = false;
        } else c2.lineTo(x, y);
      }
      c2.stroke();
    };

    const rot = baseRot + spinKick;

    // Echoes: the same figure a few frames back, dimmer, wider and lagging
    // in rotation so the trail smears into a ribbon as it spins.
    if (cfg.echo > 0) {
      const spf = audio.sampleRate / fps;
      const lag = cfg.trailSpin * 0.12;
      trace(Math.round(spf * 6), rot - lag * 2, echoColor, cfg.thickness * 3.4, cfg.echo * 0.1);
      trace(Math.round(spf * 3), rot - lag, echoColor, cfg.thickness * 2.2, cfg.echo * 0.2);
    }
    c2.shadowColor = withAlpha(color, 0.9);
    c2.shadowBlur = minDim * 0.008 * (1 + beat);
    trace(0, rot, color, cfg.thickness, 0.95);
    c2.shadowBlur = 0;
  },
});
