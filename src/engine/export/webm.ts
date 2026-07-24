/**
 * WebM fallback export via MediaRecorder for browsers without WebCodecs
 * H.264 support. Runs in realtime (the recorder consumes a live stream);
 * the UI shows a notice explaining the fallback.
 */

import type { Compositor } from '../compositor';
import type { AudioSource } from '../types';
import { toAudioBuffer } from '../audio';
import type { ExportProgress } from './mp4';

export interface WebmExportOptions {
  compositor: Compositor;
  audio: AudioSource;
  fps: number;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

export async function exportWebm(opts: WebmExportOptions): Promise<Blob> {
  const { compositor, audio, fps, signal, onProgress } = opts;
  const framesTotal = Math.max(1, Math.round(audio.duration * fps));

  const canvas = compositor.canvas as HTMLCanvasElement;
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas captureStream is not supported in this browser');
  }

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = toAudioBuffer(audio, audioCtx);
  source.connect(dest);

  const stream = new MediaStream([
    ...canvas.captureStream(fps).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve, reject) => {
    let interval = 0;
    const started = audioCtx.currentTime;

    const cleanup = () => {
      clearInterval(interval);
      try { source.stop(); } catch { /* already stopped */ }
      void audioCtx.close();
      stream.getTracks().forEach((t) => t.stop());
    };
    const abort = () => {
      cleanup();
      if (recorder.state !== 'inactive') recorder.stop();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    recorder.onstop = () => {
      signal?.removeEventListener('abort', abort);
      cleanup();
      if (signal?.aborted) return;
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
    recorder.onerror = () => {
      signal?.removeEventListener('abort', abort);
      cleanup();
      reject(new Error('MediaRecorder failed'));
    };

    source.onended = () => {
      // Give the recorder a beat to flush the tail.
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 150);
    };

    recorder.start(250);
    source.start();

    // Drive the preview compositor in realtime off the audio clock.
    interval = window.setInterval(() => {
      const t = audioCtx.currentTime - started;
      const frame = Math.min(framesTotal - 1, Math.floor(t * fps));
      compositor.renderFrame(frame);
      onProgress?.({
        ratio: Math.min(1, t / audio.duration),
        framesDone: frame + 1,
        framesTotal,
        etaSeconds: Math.max(0, audio.duration - t),
        fps,
      });
    }, 1000 / fps);
  });
}
