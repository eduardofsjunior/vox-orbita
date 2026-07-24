/**
 * Code rain: a Matrix-style wall of glyphs.
 *
 * The rain ALWAYS falls at a steady visible baseline (independent of the
 * audio), and the wall lights up like a glyph equalizer: each column maps to
 * one spectrum band (bass left → highs right) and glows from the bottom up to
 * a height set by that band's energy, brightest at the rising tip. Falling
 * heads, glyph flicker and the fill level are pure functions of time and the
 * per-frame FeatureTrack, so it stays deterministic and seek-safe.
 */

import { bandsAt, beatAt } from '../types';
import { hash01, hash2 } from '../prng';
import { defineLayer, resolveColor, withAlpha } from './api';

// Katakana + digits + a few latin glyphs — the classic rain alphabet.
const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ZXCVBNM<>*+=';

export const visMatrix = defineLayer({
  id: 'vis-matrix',
  kind: 'visualizer',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    litColor: { kind: 'color', def: 'theme:b' },
    headColor: { kind: 'color', def: '#ffffff' },
    density: { kind: 'slider', min: 0.3, max: 1, step: 0.01, def: 0.6 },
    speed: { kind: 'slider', min: 0.2, max: 3, step: 0.05, def: 1 },
    flicker: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
    reactivity: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.85 },
    beatFlash: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.4 },
    glow: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, time, theme } = rc;
    const color = resolveColor(cfg.color, theme);
    const litColor = resolveColor(cfg.litColor, theme);
    const headColor = resolveColor(cfg.headColor, theme);
    const bands = bandsAt(features, frame);
    const beat = beatAt(features, frame);

    const rows = Math.round(18 + cfg.density * 26);
    const cellH = h / rows;
    const cellW = cellH * 0.62; // mono glyph aspect
    const cols = Math.max(1, Math.ceil(w / cellW));

    c2.font = `500 ${(cellH * 0.82).toFixed(1)}px 'JetBrains Mono Variable', 'JetBrains Mono', monospace`;
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    // One shadow setup for the whole wall — per-cell shadow changes are far
    // too slow across thousands of glyphs.
    if (cfg.glow > 0) {
      c2.shadowColor = withAlpha(litColor, 0.85);
      c2.shadowBlur = cellH * cfg.glow * 0.7;
    }

    const flash = beat * cfg.beatFlash;
    const flickRate = 1.5 + cfg.flicker * 9;
    const fallRows = rows * 0.5 * cfg.speed; // rows/second — constant, not audio-gated
    const span = rows * 1.5; // heads overshoot the bottom → natural gaps

    for (let col = 0; col < cols; col++) {
      const colHash = hash01(col * 3 + 1);
      // Column → band, bass on the left. The wall *is* the spectrum.
      const band = Math.min(63, Math.floor((col / cols) * 63.999));
      const energy = Math.pow(bands[band], 1.3);
      // Equalizer fill height (rows lit from the bottom) driven by the music.
      const level = energy * rows * (0.35 + cfg.reactivity * 0.8);
      const x = (col + 0.5) * cellW;

      // Two independent rain heads per column at different phases. Motion is
      // purely time-based, so the rain keeps falling in silence.
      const head1 = (time * fallRows * (0.6 + colHash * 0.8) + colHash * span * 20) % span;
      const head2 = (time * fallRows * (0.85 + colHash * 0.5) + colHash * span * 47 + span * 0.5) % span;

      for (let row = 0; row < rows; row++) {
        const d1 = head1 - row;
        const d2 = head2 - row;
        const trail = Math.max(d1 >= 0 ? Math.exp(-d1 * 0.20) : 0, d2 >= 0 ? Math.exp(-d2 * 0.26) : 0);
        const isHead = (d1 >= 0 && d1 < 1) || (d2 >= 0 && d2 < 1);

        // Baseline wall + always-visible falling rain (audio-independent).
        let alpha = 0.05 + trail * 0.8;

        // Equalizer fill rising from the bottom, brightest at its tip.
        const distFromBottom = rows - 1 - row;
        let lit = 0;
        if (distFromBottom < level) {
          const tipDepth = level - distFromBottom; // 0 at the tip, grows down
          lit = 0.4 + Math.exp(-tipDepth * 0.55) * 0.85;
        }
        alpha = Math.min(1, alpha + lit * (0.45 + energy * 0.55) + flash * 0.14);
        if (alpha < 0.04) continue;

        // Glyphs mutate at flickRate, each cell on its own clock.
        const tick = Math.floor(time * flickRate + hash01(row * 31 + col * 7) * 7);
        const glyph = CHARS[hash2(col * 997 + row, tick) % CHARS.length];

        c2.globalAlpha = alpha;
        // Head = bright drop; lit fill = accent color; else the base rain color.
        c2.fillStyle = isHead ? headColor : lit > 0.35 ? litColor : color;
        c2.fillText(glyph, x, (row + 0.5) * cellH);
      }
    }
    c2.globalAlpha = 1;
    c2.shadowBlur = 0;
  },
});
