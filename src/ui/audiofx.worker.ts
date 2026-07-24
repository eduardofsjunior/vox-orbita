/**
 * Audio worker: runs the whole offline audio pipeline off the main thread —
 *
 *   source → timeline edits → effects chain → loudness → feature analysis
 *
 * Always starts from the ORIGINAL source channels so edits/effects are never
 * cumulative. Returns the rendered audio, the edit plan (so the UI can map
 * the playhead across cuts) and the FeatureTrack for the visuals.
 */

import { processChain, type EffectState } from '../engine/audio-fx';
import {
  applyEdits,
  buildEditPlan,
  hasActiveEdits,
  normalizeLoudness,
  type AudioEdits,
  type EditPlan,
} from '../engine/audio-edit';
import { mixToMono } from '../engine/audio';
import { computeFeatures } from '../engine/features';
import type { FeatureTrack } from '../engine/types';

interface ProcessRequest {
  channels: Float32Array[];
  sampleRate: number;
  fps: number;
  effects: EffectState[];
  edits: AudioEdits;
  /** Optional music-bed channels (already decoded at the same rate). */
  bed: Float32Array[] | null;
}

interface ProcessResult {
  channels: Float32Array[];
  features: FeatureTrack;
  plan: EditPlan;
  /** Measured loudness gain applied, dB (0 when normalization is off). */
  loudnessGainDb: number;
}

self.onmessage = (e: MessageEvent<ProcessRequest>) => {
  const { channels, sampleRate, fps, effects, edits, bed } = e.data;

  const srcMono = mixToMono(channels);
  const plan = buildEditPlan(srcMono, sampleRate, edits);

  let out = hasActiveEdits(edits)
    ? applyEdits(channels, sampleRate, edits, plan, bed)
    : channels.map((c) => c.slice());

  out = processChain(out, sampleRate, effects);

  // Loudness is last so the delivered file actually hits its LUFS target.
  const loudnessGainDb = edits.loudness.enabled
    ? normalizeLoudness(out, sampleRate, edits.loudness.targetLufs)
    : 0;

  const features = computeFeatures(mixToMono(out), sampleRate, { fps });
  const result: ProcessResult = { channels: out, features, plan, loudnessGainDb };
  const transfers = [
    ...out.map((c) => c.buffer),
    features.bands.buffer,
    features.rms.buffer,
    features.env.buffer,
    features.centroid.buffer,
    features.flux.buffer,
    features.onsets.buffer,
    features.beat.buffer,
  ] as ArrayBuffer[];
  (self as unknown as Worker).postMessage(result, transfers);
};
