/**
 * Interactive waveform strip: full-file overview, click/drag + keyboard
 * seeking (role=slider), played-portion tint and playhead.
 */

import type { AudioEdits, EditPlan } from '../engine/audio-edit';
import { waveformOverview } from '../engine/features';
import type { AudioSource } from '../engine/types';
import { t } from '../i18n';
import { el, formatTime } from './dom';

export class WaveformStrip {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overview: Float32Array | null = null;
  private duration = 0;
  private position = 0;
  private accent = '#ff6b3d';
  private dragging = false;
  /** Edit overlay: trimmed-away head/tail and removed silence spans. */
  private plan: EditPlan | null = null;
  private trim: { start: number; end: number } | null = null;

  constructor(private onSeek: (seconds: number) => void) {
    this.canvas = el('canvas', { className: 'wave-strip-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.root = el('div', {
      className: 'wave-strip',
      role: 'slider',
      tabindex: '0',
      'aria-label': t('a11y.seek'),
      'aria-valuemin': '0',
      'aria-valuemax': '0',
      'aria-valuenow': '0',
    }, this.canvas);

    const seekFromEvent = (e: PointerEvent) => {
      const rect = this.root.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.onSeek(ratio * this.duration);
    };
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      this.dragging = true;
      this.root.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (this.dragging) seekFromEvent(e);
    });
    this.root.addEventListener('pointerup', () => (this.dragging = false));
    this.root.addEventListener('keydown', (e) => {
      if (!this.duration) return;
      const step = e.shiftKey ? 1 : 5;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.onSeek(Math.min(this.duration, this.position + step));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.onSeek(Math.max(0, this.position - step));
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.onSeek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.onSeek(this.duration);
      }
    });

    new ResizeObserver(() => this.draw()).observe(this.root);
  }

  setAudio(audio: AudioSource | null): void {
    if (!audio) {
      this.overview = null;
      this.duration = 0;
    } else {
      this.overview = waveformOverview(audio.mono, 600);
      this.duration = audio.duration;
      this.root.setAttribute('aria-valuemax', String(Math.round(audio.duration)));
    }
    this.draw();
  }

  setAccent(color: string): void {
    this.accent = color;
    this.draw();
  }

  /**
   * Show which parts of the source survive the edits: the region outside the
   * trim is dimmed and removed silences are hatched, so the strip explains
   * what the export will contain.
   */
  setEditPlan(plan: EditPlan | null, edits: AudioEdits): void {
    this.plan = plan;
    this.trim = plan
      ? { start: edits.trimStart, end: edits.trimEnd > 0 ? edits.trimEnd : plan.srcDuration }
      : null;
    this.draw();
  }

  setPosition(seconds: number): void {
    this.position = seconds;
    this.root.setAttribute('aria-valuenow', String(Math.round(seconds)));
    this.root.setAttribute('aria-valuetext', formatTime(seconds));
    this.draw();
  }

  private draw(): void {
    const rect = this.root.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const { ctx } = this;
    ctx.clearRect(0, 0, w, h);
    if (!this.overview) return;

    const mid = h / 2;
    const buckets = this.overview.length / 2;
    const playedX = this.duration > 0 ? (this.position / this.duration) * w : 0;

    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? 'rgba(255,255,255,0.22)' : this.accent;
      ctx.beginPath();
      for (let b = 0; b < buckets; b++) {
        const x = (b / buckets) * w;
        if (pass === 1 && x > playedX) break;
        const mn = this.overview[b * 2];
        const mx = this.overview[b * 2 + 1];
        const y0 = mid - mx * mid * 0.92;
        const y1 = mid - mn * mid * 0.92;
        ctx.rect(x, y0, Math.max(1, w / buckets - dpr * 0.5), Math.max(dpr, y1 - y0));
      }
      ctx.fill();
    }

    // --- Edit overlay ---
    const toX = (seconds: number) => (this.duration > 0 ? (seconds / this.duration) * w : 0);
    if (this.trim) {
      // Dim everything the trim discards.
      ctx.fillStyle = 'rgba(6,8,12,0.72)';
      const inX = toX(this.trim.start);
      const outX = toX(this.trim.end);
      if (inX > 0) ctx.fillRect(0, 0, inX, h);
      if (outX < w) ctx.fillRect(outX, 0, w - outX, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      if (inX > 0) ctx.fillRect(inX - dpr / 2, 0, dpr, h);
      if (outX < w) ctx.fillRect(outX - dpr / 2, 0, dpr, h);
    }
    if (this.plan) {
      // Hatch the silences that will be cut out.
      for (const r of this.plan.removed) {
        const x0 = toX(r.start);
        const x1 = toX(r.end);
        ctx.fillStyle = 'rgba(255,86,86,0.28)';
        ctx.fillRect(x0, 0, Math.max(dpr, x1 - x0), h);
        ctx.fillStyle = 'rgba(255,86,86,0.85)';
        ctx.fillRect(x0, h - dpr * 2, Math.max(dpr, x1 - x0), dpr * 2);
      }
    }

    // Playhead.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(playedX - dpr / 2, 0, dpr, h);
  }
}
