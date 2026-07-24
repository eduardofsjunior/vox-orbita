/**
 * Export dialog: codec notice, progress + ETA + cancel, download when done.
 */

import type { ExportSupport } from '../engine/export/capabilities';
import type { ExportProgress } from '../engine/export/mp4';
import { t } from '../i18n';
import { clear, downloadBlob, el, formatTime } from './dom';

export interface ExportJob {
  fileName: string;
  support: ExportSupport;
  summary: string;
  run(onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<Blob>;
}

export class ExportDialog {
  readonly root: HTMLDialogElement;
  private abort: AbortController | null = null;
  /** Last successful export — also read by the e2e smoke test. */
  lastBlob: Blob | null = null;

  constructor() {
    this.root = el('dialog', { className: 'export-dialog' });
    this.root.addEventListener('cancel', () => this.abort?.abort());
  }

  open(job: ExportJob): void {
    this.renderSetup(job);
    this.root.showModal();
  }

  private renderSetup(job: ExportJob): void {
    clear(this.root);
    const notice =
      job.support.kind === 'webm' ? el('p', { className: 'export-notice' }, t('export.webmNotice'))
      : job.support.kind === 'none' ? el('p', { className: 'export-notice export-notice-error' }, t('export.noneNotice'))
      : null;
    const codecLine = job.support.kind === 'mp4'
      ? t('export.mp4Ready', { audio: job.support.audioCodec.toUpperCase() })
      : job.support.kind === 'webm' ? 'WebM · VP9/Opus' : '—';

    this.root.append(
      el('h2', {}, t('export.title')),
      el('p', { className: 'export-summary' }, job.summary),
      el('p', { className: 'export-codec' }, codecLine),
      ...(notice ? [notice] : []),
      el('div', { className: 'dialog-actions' },
        el('button', { className: 'btn btn-ghost', onclick: () => this.root.close() }, t('export.close')),
        job.support.kind !== 'none'
          ? el('button', { className: 'btn btn-primary', onclick: () => this.start(job) }, t('export.start'))
          : null,
      ),
    );
  }

  private start(job: ExportJob): void {
    this.abort = new AbortController();
    clear(this.root);
    const bar = el('div', { className: 'progress-fill' });
    const pct = el('span', { className: 'progress-pct mono' }, '0%');
    const eta = el('span', { className: 'progress-eta mono' }, t('export.preparing'));
    const frames = el('p', { className: 'progress-frames' }, '');
    this.root.append(
      el('h2', {}, t('export.title')),
      el('div', { className: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar),
      el('div', { className: 'progress-row' }, pct, eta),
      frames,
      el('div', { className: 'dialog-actions' },
        el('button', { className: 'btn btn-ghost', onclick: () => this.abort?.abort() }, t('export.cancel')),
      ),
    );
    const track = this.root.querySelector('.progress-track')!;

    job.run((p) => {
      bar.style.width = `${(p.ratio * 100).toFixed(1)}%`;
      pct.textContent = `${Math.round(p.ratio * 100)}%`;
      track.setAttribute('aria-valuenow', String(Math.round(p.ratio * 100)));
      eta.textContent = p.etaSeconds != null ? `${t('export.eta')} ${formatTime(p.etaSeconds)}` : t('export.preparing');
      frames.textContent = `${p.framesDone.toLocaleString()} / ${p.framesTotal.toLocaleString()} ${t('export.frames')}`;
    }, this.abort.signal)
      .then((blob) => {
        this.lastBlob = blob;
        this.renderDone(job, blob);
        downloadBlob(blob, job.fileName + (blob.type.includes('mp4') ? '.mp4' : '.webm'));
      })
      .catch((err: unknown) => {
        const cancelled = err instanceof DOMException && err.name === 'AbortError';
        this.renderError(cancelled ? t('export.cancelled') : `${t('export.failed')}: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  private renderDone(job: ExportJob, blob: Blob): void {
    clear(this.root);
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    this.root.append(
      el('h2', {}, t('export.done')),
      el('p', { className: 'export-summary' }, `${job.fileName}${blob.type.includes('mp4') ? '.mp4' : '.webm'} · ${mb} MB`),
      el('div', { className: 'dialog-actions' },
        el('button', { className: 'btn btn-ghost', onclick: () => this.root.close() }, t('export.close')),
        el('button', {
          className: 'btn btn-primary',
          onclick: () => downloadBlob(blob, job.fileName + (blob.type.includes('mp4') ? '.mp4' : '.webm')),
        }, t('export.download')),
      ),
    );
  }

  private renderError(message: string): void {
    clear(this.root);
    this.root.append(
      el('h2', {}, t('export.title')),
      el('p', { className: 'export-notice' }, message),
      el('div', { className: 'dialog-actions' },
        el('button', { className: 'btn btn-ghost', onclick: () => this.root.close() }, t('export.close')),
      ),
    );
  }
}
