/**
 * MP4 export: renders every frame through the shared Compositor (the same
 * code path as preview — timestamps derived from frame index only) and
 * encodes with WebCodecs into an in-memory MP4 via mp4-muxer.
 *
 * Runs faster than realtime: frames are produced as fast as the encoder
 * queue allows, with cooperative yields to keep the UI responsive.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Compositor } from '../compositor';
import type { AudioSource } from '../types';
import { videoBitrate, type Mp4Support } from './capabilities';

export interface ExportProgress {
  /** 0..1 overall. */
  ratio: number;
  framesDone: number;
  framesTotal: number;
  /** Estimated seconds remaining, or null while warming up. */
  etaSeconds: number | null;
  fps: number;
}

export interface Mp4ExportOptions {
  compositor: Compositor;
  audio: AudioSource;
  fps: number;
  width: number;
  height: number;
  support: Mp4Support;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

const AUDIO_CHUNK_FRAMES = 4800; // 100 ms at 48 kHz — arbitrary, sample-accurate.

export async function exportMp4(opts: Mp4ExportOptions): Promise<Blob> {
  const { compositor, audio, fps, width, height, support, signal, onProgress } = opts;
  const framesTotal = Math.max(1, Math.round(audio.duration * fps));
  const channelCount = Math.min(2, audio.channels.length);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: {
      codec: support.audioCodec,
      numberOfChannels: channelCount,
      sampleRate: audio.sampleRate,
    },
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const fail = (e: unknown) => {
    encodeError ??= e instanceof Error ? e : new Error(String(e));
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  videoEncoder.configure({
    codec: support.videoCodec,
    width,
    height,
    framerate: fps,
    bitrate: videoBitrate(width, height, fps),
    avc: support.videoCodec.startsWith('avc1') ? { format: 'avc' } : undefined,
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: fail,
  });
  audioEncoder.configure({
    codec: support.audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: audio.sampleRate,
    numberOfChannels: channelCount,
    bitrate: 192_000,
  });

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (encodeError) throw encodeError;
  };

  try {
    // ---- Audio: feed the raw PCM sample-accurately. ----
    const totalSamples = audio.channels[0].length;
    const planar = new Float32Array(AUDIO_CHUNK_FRAMES * channelCount);
    for (let offset = 0; offset < totalSamples; offset += AUDIO_CHUNK_FRAMES) {
      throwIfAborted();
      const frames = Math.min(AUDIO_CHUNK_FRAMES, totalSamples - offset);
      for (let c = 0; c < channelCount; c++) {
        planar.set(audio.channels[c].subarray(offset, offset + frames), c * frames);
      }
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: audio.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channelCount,
        timestamp: Math.round((offset * 1e6) / audio.sampleRate),
        data: planar.subarray(0, frames * channelCount),
      });
      audioEncoder.encode(data);
      data.close();
      if (audioEncoder.encodeQueueSize > 8) await waitForQueue(audioEncoder, 4, signal);
    }

    // ---- Video: render + encode every frame. ----
    const usPerFrame = 1e6 / fps;
    const keyInterval = fps * 2; // keyframe every 2 s
    const started = performance.now();
    let lastYield = started;

    for (let n = 0; n < framesTotal; n++) {
      throwIfAborted();
      compositor.renderFrame(n);
      const frame = new VideoFrame(compositor.canvas as CanvasImageSource, {
        timestamp: Math.round(n * usPerFrame),
        duration: Math.round((n + 1) * usPerFrame) - Math.round(n * usPerFrame),
      });
      videoEncoder.encode(frame, { keyFrame: n % keyInterval === 0 });
      frame.close();

      if (videoEncoder.encodeQueueSize > 4) await waitForQueue(videoEncoder, 2, signal);

      const now = performance.now();
      if (now - lastYield > 40) {
        lastYield = now;
        const elapsed = (now - started) / 1000;
        const done = n + 1;
        onProgress?.({
          ratio: done / framesTotal,
          framesDone: done,
          framesTotal,
          etaSeconds: elapsed > 1 ? (elapsed / done) * (framesTotal - done) : null,
          fps,
        });
        await yieldToUi();
      }
    }

    throwIfAborted();
    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    throwIfAborted();
    muxer.finalize();
    onProgress?.({ ratio: 1, framesDone: framesTotal, framesTotal, etaSeconds: 0, fps });
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder.state !== 'closed') audioEncoder.close();
  }
}

function waitForQueue(encoder: VideoEncoder | AudioEncoder, until: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (signal?.aborted || encoder.state === 'closed' || encoder.encodeQueueSize <= until) resolve();
      else setTimeout(check, 2);
    };
    check();
  });
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
