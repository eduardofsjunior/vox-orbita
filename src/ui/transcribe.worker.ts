/**
 * Transcription worker: runs OpenAI Whisper entirely in the browser via
 * transformers.js. The model weights are fetched from the Hugging Face CDN
 * once and cached; the user's AUDIO never leaves the machine — it is decoded
 * to 16 kHz mono here and fed straight to local inference.
 *
 * transformers.js is heavy, so it is dynamically imported only when a
 * transcription is actually requested (keeps the base studio bundle light).
 */

import { groupWords, type CaptionTrack, type CaptionWord } from '../engine/captions';

interface TranscribeRequest {
  /** Mono PCM at `sampleRate`. */
  mono: Float32Array;
  sampleRate: number;
  /** Whisper model id, e.g. 'Xenova/whisper-tiny'. */
  model: string;
  /** 'auto' to auto-detect, or a language code like 'en' / 'pt'. */
  language: string;
}

type Progress =
  | { type: 'progress'; stage: string; ratio: number | null }
  | { type: 'done'; track: CaptionTrack }
  | { type: 'error'; message: string };

const post = (m: Progress) => (self as unknown as Worker).postMessage(m);

/** Linear-resample mono PCM to 16 kHz (Whisper's expected rate). */
function resampleTo16k(mono: Float32Array, sampleRate: number): Float32Array {
  const target = 16000;
  if (sampleRate === target) return mono;
  const ratio = sampleRate / target;
  const outLen = Math.floor(mono.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = mono[i0] ?? 0;
    const b = mono[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<TranscribeRequest>) => {
  const { mono, sampleRate, model, language } = e.data;
  try {
    post({ type: 'progress', stage: 'load', ratio: null });
    const { pipeline } = await import('@huggingface/transformers');

    const asr = await pipeline('automatic-speech-recognition', model, {
      // Report model-download progress (fired per file, per byte range).
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          post({ type: 'progress', stage: 'download', ratio: p.progress / 100 });
        }
      },
    });

    post({ type: 'progress', stage: 'transcribe', ratio: null });
    const audio = resampleTo16k(mono, sampleRate);
    const result = (await asr(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language === 'auto' ? undefined : language,
      task: 'transcribe',
    })) as { text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> };

    const words: CaptionWord[] = (result.chunks ?? [])
      .filter((c) => c.timestamp[0] != null)
      .map((c, i, arr) => {
        const start = c.timestamp[0];
        // Whisper occasionally omits an end time; fall back to the next start.
        const end = c.timestamp[1] ?? arr[i + 1]?.timestamp[0] ?? start + 0.4;
        return { text: c.text.trim(), start, end };
      })
      .filter((w) => w.text.length > 0);

    const lines = groupWords(words, { maxWords: 7, gapSeconds: 0.6 });
    post({ type: 'done', track: { lines, language } });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
