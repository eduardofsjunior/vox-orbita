/**
 * Caption track model + pure helpers.
 *
 * A CaptionTrack is timestamped text produced once by transcription (or hand
 * edited) and then rendered deterministically: the caption overlay reads the
 * track + the current frame time, so preview and export match exactly. None
 * of this depends on the transcription engine — it's plain data + math, so it
 * is fully unit-testable.
 */

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

/** One displayed caption line (a group of words shown together). */
export interface CaptionLine {
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface CaptionTrack {
  lines: CaptionLine[];
  /** BCP-47-ish language tag the transcription used ('en', 'pt', 'auto'…). */
  language: string;
}

export interface GroupOptions {
  /** Max words per displayed line. */
  maxWords: number;
  /** Start a new line when the silent gap before a word exceeds this (s). */
  gapSeconds: number;
}

const SENTENCE_END = /[.!?…]$/;

/**
 * Group a flat word list into display lines. A new line starts when the max
 * word count is hit, a long gap precedes the word, or the previous word ended
 * a sentence. Deterministic and pure.
 */
export function groupWords(words: readonly CaptionWord[], opts: GroupOptions): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = current[current.length - 1];
    const bigGap = prev !== undefined && w.start - prev.end > opts.gapSeconds;
    const sentenceBreak = prev !== undefined && SENTENCE_END.test(prev.text);
    if (current.length >= opts.maxWords || bigGap || sentenceBreak) flush();
    current.push(w);
  }
  flush();
  return lines;
}

/** Binary-search the line active at `time`, or null if none is showing. */
export function activeLineAt(track: CaptionTrack, time: number): CaptionLine | null {
  const lines = track.lines;
  let lo = 0;
  let hi = lines.length - 1;
  let found: CaptionLine | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (time < line.start) hi = mid - 1;
    else if (time > line.end) lo = mid + 1;
    else {
      found = line;
      break;
    }
  }
  return found;
}

/**
 * Index of the word active at `time` within a line (for karaoke highlight).
 * Returns the last word whose start has passed, so the highlight advances
 * word-by-word and holds on the final word until the line ends. -1 before the
 * first word starts.
 */
export function activeWordIndex(line: CaptionLine, time: number): number {
  let idx = -1;
  for (let i = 0; i < line.words.length; i++) {
    if (time >= line.words[i].start) idx = i;
    else break;
  }
  return idx;
}

/** Total number of words across the track. */
export function wordCount(track: CaptionTrack): number {
  let n = 0;
  for (const l of track.lines) n += l.words.length;
  return n;
}

/** Serialize to WebVTT (sidecar caption file). */
export function toVtt(track: CaptionTrack): string {
  const ts = (s: number): string => {
    const hh = Math.floor(s / 3600).toString().padStart(2, '0');
    const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    const ms = Math.round((s % 1) * 1000).toString().padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  };
  const body = track.lines
    .map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end)}\n${l.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
