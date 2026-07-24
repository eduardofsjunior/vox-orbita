/**
 * Audio decoding (browser-only, uses Web Audio) and AudioSource construction.
 */

import type { AudioSource } from './types';

/** Decode an audio file (MP3/OGG/WAV/…) into an AudioSource. */
export async function decodeAudioFile(file: File | Blob, fileName: string): Promise<AudioSource> {
  const arrayBuffer = await file.arrayBuffer();
  // A throwaway AudioContext decodes at its own rate; that's fine — analysis
  // and export both derive everything from the decoded buffer itself.
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer);
    return fromAudioBuffer(buf, fileName);
  } finally {
    void ctx.close();
  }
}

export function fromAudioBuffer(buf: AudioBuffer, fileName: string): AudioSource {
  const channels: Float32Array[] = [];
  const chCount = Math.min(2, buf.numberOfChannels);
  for (let c = 0; c < chCount; c++) channels.push(buf.getChannelData(c).slice());
  return fromChannels(channels, buf.sampleRate, fileName);
}

export function fromChannels(channels: Float32Array[], sampleRate: number, fileName: string): AudioSource {
  const mono = mixToMono(channels);
  return {
    sampleRate,
    duration: mono.length / sampleRate,
    channels,
    mono,
    fileName,
  };
}

export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  }
  return out;
}

/** Rebuild an AudioBuffer from an AudioSource for playback. */
export function toAudioBuffer(src: AudioSource, ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(src.channels.length, src.channels[0].length, src.sampleRate);
  src.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return buf;
}
