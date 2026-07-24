/**
 * Export capability detection. Preference order:
 *   1. WebCodecs H.264 + AAC  → MP4 (best compatibility)
 *   2. WebCodecs H.264 + Opus → MP4 (Chromium builds without AAC licensing)
 *   3. MediaRecorder          → WebM (fallback, realtime, with a user notice)
 */

export type AudioCodecChoice = 'aac' | 'opus';

export interface Mp4Support {
  kind: 'mp4';
  videoCodec: string;
  audioCodec: AudioCodecChoice;
}
export interface WebmSupport {
  kind: 'webm';
}
export interface NoSupport {
  kind: 'none';
}
export type ExportSupport = Mp4Support | WebmSupport | NoSupport;

/** H.264 codec strings to try, highest capability first. */
const AVC_CANDIDATES = [
  'avc1.640034', // High 5.2 (4K60)
  'avc1.640033', // High 5.1 (4K30)
  'avc1.64002A', // High 4.2 (1080p60)
  'avc1.640028', // High 4.0 (1080p30)
  'avc1.4D0032', // Main 5.0
  'avc1.42003E', // Baseline 6.2 — constrained builds (openh264)
  'avc1.420034', // Baseline 5.2
  'avc1.42E01E', // Constrained Baseline 3.0
];

export async function detectExportSupport(width: number, height: number, fps: number): Promise<ExportSupport> {
  if (typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined') {
    const videoCodec = await findAvcCodec(width, height, fps);
    if (videoCodec) {
      const audioCodec = await findAudioCodec();
      if (audioCodec) return { kind: 'mp4', videoCodec, audioCodec };
    }
  }
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('video/webm')) {
    return { kind: 'webm' };
  }
  return { kind: 'none' };
}

async function findAvcCodec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of AVC_CANDIDATES) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate: fps,
        bitrate: videoBitrate(width, height, fps),
      });
      if (supported) return codec;
    } catch {
      // Malformed-config errors on some engines — just try the next candidate.
    }
  }
  return null;
}

async function findAudioCodec(): Promise<AudioCodecChoice | null> {
  for (const [codec, name] of [['mp4a.40.2', 'aac'], ['opus', 'opus']] as const) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192_000,
      });
      if (supported) return name;
    } catch {
      // Try the next codec.
    }
  }
  return null;
}

/**
 * Practical resolution ceiling per frame rate. H.264 level 5.2 tops out
 * around 1080p120 / 4K60 in real encoders, so the UI greys out combinations
 * that would fail the probe rather than surprising the user at export time.
 */
export function maxHeightForFps(fps: number): number {
  if (fps >= 120) return 1080;
  if (fps >= 60) return 2160;
  return 2160;
}

/** Bitrate heuristic ≈ 0.11 bits per pixel per frame, clamped 2..40 Mbps. */
export function videoBitrate(width: number, height: number, fps: number): number {
  const bps = width * height * fps * 0.11;
  return Math.round(Math.min(40e6, Math.max(2e6, bps)));
}
