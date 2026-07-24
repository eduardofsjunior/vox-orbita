/**
 * Caption overlay: renders the transcribed caption line active at the current
 * time, with optional karaoke word highlighting. Reads the caption track from
 * `rc.captions` (populated by transcription) and its own style config; purely
 * a function of (time, track, config), so preview and export match.
 */

import { activeLineAt, activeWordIndex, type CaptionWord } from '../captions';
import { defineLayer, resolveColor, withAlpha } from './api';

const POSITIONS = ['bottom', 'center', 'top'] as const;
const STYLES = ['karaoke', 'highlight', 'plain'] as const;

export const ovCaptions = defineLayer({
  id: 'ov-captions',
  kind: 'overlay',
  schema: {
    style: { kind: 'select', options: STYLES, def: 'karaoke' },
    position: { kind: 'select', options: POSITIONS, def: 'bottom' },
    size: { kind: 'slider', min: 0.4, max: 2.2, step: 0.05, def: 1 },
    color: { kind: 'color', def: '#ffffff' },
    activeColor: { kind: 'color', def: 'theme:a' },
    boxOpacity: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.45 },
    maxWidth: { kind: 'slider', min: 0.4, max: 0.95, step: 0.01, def: 0.82 },
    uppercase: { kind: 'toggle', def: false },
    shadow: { kind: 'toggle', def: true },
  },
  render(rc, cfg) {
    const { c2, w, h, time, theme, captions } = rc;
    if (!captions || captions.lines.length === 0) return;
    const line = activeLineAt(captions, time);
    if (!line) return;

    const minDim = Math.min(w, h);
    const fontPx = minDim * 0.045 * (cfg.size as number);
    const color = resolveColor(cfg.color as string, theme);
    const activeColor = resolveColor(cfg.activeColor as string, theme);
    const style = cfg.style as string;
    const uppercase = cfg.uppercase as boolean;
    const activeIdx = style === 'plain' ? -1 : activeWordIndex(line, time);

    c2.font = `700 ${fontPx.toFixed(1)}px 'Space Grotesk Variable', 'Space Grotesk', sans-serif`;
    c2.textBaseline = 'alphabetic';

    // Word-wrap the line's words into rows that fit maxWidth.
    const maxW = w * (cfg.maxWidth as number);
    const space = c2.measureText(' ').width;
    const disp = (t: string) => (uppercase ? t.toUpperCase() : t);
    type Row = { words: Array<{ w: CaptionWord; i: number; width: number }>; width: number };
    const rows: Row[] = [];
    let row: Row = { words: [], width: 0 };
    line.words.forEach((word, i) => {
      const width = c2.measureText(disp(word.text)).width;
      const add = row.words.length === 0 ? width : row.width + space + width;
      if (row.words.length > 0 && add > maxW) {
        rows.push(row);
        row = { words: [], width: 0 };
      }
      row.width = row.words.length === 0 ? width : row.width + space + width;
      row.words.push({ w: word, i, width });
    });
    if (row.words.length > 0) rows.push(row);

    const lineH = fontPx * 1.28;
    const totalH = rows.length * lineH;
    const margin = minDim * 0.08;
    const pos = cfg.position as string;
    const blockTop = pos === 'top' ? margin : pos === 'center' ? (h - totalH) / 2 : h - margin - totalH;

    // Background box behind the text block.
    if ((cfg.boxOpacity as number) > 0) {
      const padX = fontPx * 0.5;
      const padY = fontPx * 0.32;
      let boxW = 0;
      for (const r of rows) boxW = Math.max(boxW, r.width);
      const bx = (w - boxW) / 2 - padX;
      const by = blockTop - padY;
      c2.fillStyle = `rgba(0,0,0,${cfg.boxOpacity as number})`;
      roundRect(c2, bx, by, boxW + padX * 2, totalH + padY * 2, fontPx * 0.25);
      c2.fill();
    }

    if (cfg.shadow as boolean) {
      c2.shadowColor = 'rgba(0,0,0,0.6)';
      c2.shadowBlur = fontPx * 0.18;
      c2.shadowOffsetY = fontPx * 0.04;
    }

    rows.forEach((r, ri) => {
      const baseY = blockTop + ri * lineH + fontPx;
      let x = (w - r.width) / 2; // centered row
      for (const { i, width } of r.words) {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        if (style === 'karaoke') {
          // Spoken words + the current word use the active color; upcoming
          // words are dimmed until reached.
          c2.fillStyle = isActive || isPast ? activeColor : withAlpha(color, 0.55);
        } else if (style === 'highlight') {
          c2.fillStyle = isActive ? activeColor : color;
        } else {
          c2.fillStyle = color;
        }
        c2.textAlign = 'left';
        c2.fillText(disp(line.words[i].text), x, baseY);
        x += width + space;
      }
    });

    c2.shadowBlur = 0;
    c2.shadowOffsetY = 0;
  },
});

function roundRect(
  c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  c2.beginPath();
  c2.moveTo(x + rr, y);
  c2.arcTo(x + w, y, x + w, y + h, rr);
  c2.arcTo(x + w, y + h, x, y + h, rr);
  c2.arcTo(x, y + h, x, y, rr);
  c2.arcTo(x, y, x + w, y, rr);
  c2.closePath();
}
