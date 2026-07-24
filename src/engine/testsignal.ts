/**
 * Synthetic signal generators — used by the demo mode, unit tests and the
 * Playwright smoke test. Deterministic by construction.
 */

import { fromChannels } from './audio';
import type { AudioSource } from './types';

/** Pure sine tone. */
export function sine(freq: number, duration: number, sampleRate: number, gain = 0.5): Float32Array {
  const n = Math.round(duration * sampleRate);
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = Math.sin(w * i) * gain;
  return out;
}

/**
 * Click track: short broadband bursts every `interval` seconds.
 * Used to validate onset detection (each click must produce one onset).
 */
export function clickTrack(duration: number, interval: number, sampleRate: number): Float32Array {
  const n = Math.round(duration * sampleRate);
  const out = new Float32Array(n);
  const clickLen = Math.round(sampleRate * 0.012);
  for (let t = interval; t < duration - 0.05; t += interval) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < clickLen && start + i < n; i++) {
      // Decaying noise burst — deterministic "noise" from a hash-free chirp mix.
      const decay = 1 - i / clickLen;
      out[start + i] += (Math.sin(i * 0.91) * 0.5 + Math.sin(i * 2.13) * 0.3 + Math.sin(i * 4.7) * 0.2) * decay * 0.9;
    }
  }
  return out;
}

/**
 * Demo groove: a small deterministic "track" (kick pattern + bass + arpeggio)
 * that makes every visualizer look alive without shipping an audio asset.
 */
export function demoGroove(sampleRate = 44100, duration = 12): AudioSource {
  const n = Math.round(duration * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const bpm = 112;
  const beatLen = 60 / bpm;
  const scale = [0, 3, 5, 7, 10]; // minor pentatonic
  const baseHz = 220;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beatPos = t / beatLen;
    const beatIdx = Math.floor(beatPos);
    const inBeat = (beatPos - beatIdx) * beatLen;

    // Kick on every beat: pitched-down sine thump.
    let kick = 0;
    if (inBeat < 0.14) {
      const env = Math.exp(-inBeat * 34);
      kick = Math.sin(2 * Math.PI * (58 + 60 * Math.exp(-inBeat * 46)) * inBeat) * env * 0.85;
    }

    // Bass: root note, eighth-note gate.
    const eighth = Math.floor(beatPos * 2);
    const bassHz = 55 * Math.pow(2, scale[(eighth >> 2) % scale.length] / 12);
    const bassGate = (beatPos * 2) % 1 < 0.72 ? 1 : 0;
    const bass = Math.sin(2 * Math.PI * bassHz * t) * 0.24 * bassGate;

    // Arpeggio: 16th notes walking the pentatonic, ping-pong panned.
    const sixteenth = Math.floor(beatPos * 4);
    const noteHz = baseHz * Math.pow(2, scale[sixteenth % scale.length] / 12 + Math.floor((sixteenth % 10) / 5));
    const notePos = (beatPos * 4) % 1;
    const arpEnv = Math.exp(-notePos * 7) * 0.3;
    const arp = (Math.sin(2 * Math.PI * noteHz * t) + 0.35 * Math.sin(2 * Math.PI * noteHz * 2 * t)) * arpEnv;
    const panL = sixteenth % 2 === 0 ? 0.85 : 0.35;

    // Hat: 16th offbeats, tiny bright chirp.
    let hat = 0;
    if (notePos < 0.05 && sixteenth % 2 === 1) {
      hat = Math.sin(2 * Math.PI * 9000 * t) * Math.exp(-notePos * 90) * 0.12;
    }

    const common = kick + bass;
    left[i] = common + arp * panL + hat;
    right[i] = common + arp * (1.2 - panL) + hat;
  }

  // Gentle fade-out to avoid an end click.
  const fade = Math.round(sampleRate * 0.2);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    left[n - 1 - i] *= g;
    right[n - 1 - i] *= g;
  }
  return fromChannels([left, right], sampleRate, 'vox-orbita-demo.wav');
}
