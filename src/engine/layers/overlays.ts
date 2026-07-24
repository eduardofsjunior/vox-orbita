/**
 * Overlays: title/subtitle text, episode progress bar, logo/avatar image.
 */

import { beatAt } from '../types';
import { defineLayer, resolveColor, withAlpha } from './api';

const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'] as const;

function anchor(pos: string, w: number, h: number, margin: number): { x: number; y: number; alignX: CanvasTextAlign; alignY: 'top' | 'middle' | 'bottom' } {
  const [v, hz] = pos === 'center' ? ['center', 'center'] : pos.split('-');
  const x = hz === 'left' ? margin : hz === 'right' ? w - margin : w / 2;
  const y = v === 'top' ? margin : v === 'bottom' ? h - margin : h / 2;
  return {
    x,
    y,
    alignX: hz === 'left' ? 'left' : hz === 'right' ? 'right' : 'center',
    alignY: v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle',
  };
}

export const ovText = defineLayer({
  id: 'ov-text',
  kind: 'overlay',
  schema: {
    title: { kind: 'text', def: '' },
    subtitle: { kind: 'text', def: '' },
    position: { kind: 'select', options: POSITIONS, def: 'bottom-left' },
    size: { kind: 'slider', min: 0.4, max: 2.5, step: 0.05, def: 1 },
    color: { kind: 'color', def: '#ffffff' },
    subtitleColor: { kind: 'color', def: 'theme:c' },
    shadow: { kind: 'toggle', def: true },
  },
  render(rc, cfg) {
    const { c2, w, h, theme } = rc;
    if (!cfg.title && !cfg.subtitle) return;
    const minDim = Math.min(w, h);
    const margin = minDim * 0.07;
    const a = anchor(cfg.position, w, h, margin);
    const titleSize = minDim * 0.052 * cfg.size;
    const subSize = titleSize * 0.48;
    const gap = titleSize * 0.32;

    c2.textAlign = a.alignX;
    if (cfg.shadow) {
      c2.shadowColor = 'rgba(0,0,0,0.55)';
      c2.shadowBlur = minDim * 0.012;
      c2.shadowOffsetY = minDim * 0.002;
    }

    const blockH = (cfg.title ? titleSize : 0) + (cfg.title && cfg.subtitle ? gap : 0) + (cfg.subtitle ? subSize : 0);
    let y = a.alignY === 'top' ? a.y : a.alignY === 'bottom' ? a.y - blockH : a.y - blockH / 2;

    if (cfg.title) {
      c2.font = `600 ${titleSize}px 'Space Grotesk Variable', 'Space Grotesk', sans-serif`;
      c2.textBaseline = 'top';
      c2.fillStyle = resolveColor(cfg.color, theme);
      c2.fillText(cfg.title, a.x, y);
      y += titleSize + gap;
    }
    if (cfg.subtitle) {
      c2.font = `500 ${subSize}px 'Inter Variable', 'Inter', sans-serif`;
      c2.textBaseline = 'top';
      c2.fillStyle = resolveColor(cfg.subtitleColor, theme);
      c2.fillText(cfg.subtitle, a.x, y);
    }
    c2.shadowBlur = 0;
    c2.shadowOffsetY = 0;
  },
});

export const ovProgress = defineLayer({
  id: 'ov-progress',
  kind: 'overlay',
  schema: {
    color: { kind: 'color', def: 'theme:a' },
    trackColor: { kind: 'color', def: '#ffffff' },
    position: { kind: 'select', options: ['top', 'bottom'], def: 'bottom' },
    thickness: { kind: 'slider', min: 2, max: 20, step: 1, def: 6 },
    inset: { kind: 'slider', min: 0, max: 0.1, step: 0.005, def: 0.04 },
    showTime: { kind: 'toggle', def: true },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame, theme } = rc;
    const progress = Math.min(1, frame / Math.max(1, features.frameCount - 1));
    const minDim = Math.min(w, h);
    const inset = w * cfg.inset;
    const barW = w - inset * 2;
    const th = (cfg.thickness * minDim) / 1080;
    const y = cfg.position === 'top' ? Math.max(inset, th) : h - Math.max(inset, th) - th;
    const color = resolveColor(cfg.color, theme);

    c2.fillStyle = withAlpha(resolveColor(cfg.trackColor, theme), 0.16);
    fillRounded(c2, inset, y, barW, th);
    c2.fillStyle = color;
    fillRounded(c2, inset, y, Math.max(th, barW * progress), th);

    if (cfg.showTime) {
      const t = frame / features.fps;
      const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
      const fs = minDim * 0.024;
      c2.font = `500 ${fs}px 'JetBrains Mono Variable', 'JetBrains Mono', monospace`;
      c2.textBaseline = cfg.position === 'top' ? 'top' : 'bottom';
      c2.shadowColor = 'rgba(0,0,0,0.5)';
      c2.shadowBlur = fs * 0.3;
      const textY = cfg.position === 'top' ? y + th + fs * 0.4 : y - fs * 0.4;
      c2.fillStyle = 'rgba(255,255,255,0.85)';
      c2.textAlign = 'left';
      c2.fillText(fmt(t), inset, textY);
      c2.textAlign = 'right';
      c2.fillText(fmt(features.duration), inset + barW, textY);
      c2.shadowBlur = 0;
    }
  },
});

export const ovLogo = defineLayer({
  id: 'ov-logo',
  kind: 'overlay',
  schema: {
    image: { kind: 'image', def: null },
    position: { kind: 'select', options: POSITIONS, def: 'top-right' },
    size: { kind: 'slider', min: 0.05, max: 0.4, step: 0.01, def: 0.12 },
    round: { kind: 'toggle', def: true },
    opacity: { kind: 'slider', min: 0.2, max: 1, step: 0.01, def: 1 },
    beatScale: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.35 },
  },
  render(rc, cfg) {
    const { c2, w, h, features, frame } = rc;
    const img = cfg.image;
    if (!img) return;
    const minDim = Math.min(w, h);
    const beat = beatAt(features, frame);
    const size = minDim * cfg.size * (1 + beat * cfg.beatScale * 0.14);
    const margin = minDim * 0.06;
    const a = anchor(cfg.position, w, h, margin + size / 2);

    c2.globalAlpha = cfg.opacity;
    c2.save();
    if (cfg.round) {
      c2.beginPath();
      c2.arc(a.x, a.y, size / 2, 0, Math.PI * 2);
      c2.clip();
    }
    const scale = Math.max(size / img.bitmap.width, size / img.bitmap.height);
    c2.drawImage(
      img.bitmap,
      a.x - (img.bitmap.width * scale) / 2,
      a.y - (img.bitmap.height * scale) / 2,
      img.bitmap.width * scale,
      img.bitmap.height * scale,
    );
    c2.restore();
    c2.globalAlpha = 1;
  },
});

function fillRounded(
  c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = h / 2;
  c2.beginPath();
  c2.moveTo(x + r, y);
  c2.arcTo(x + w, y, x + w, y + h, r);
  c2.arcTo(x + w, y + h, x, y + h, r);
  c2.arcTo(x, y + h, x, y, r);
  c2.arcTo(x, y, x + w, y, r);
  c2.closePath();
  c2.fill();
}
