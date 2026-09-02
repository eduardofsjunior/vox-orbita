import { describe, expect, it } from 'vitest';
import {
  activeLineAt,
  activeWordIndex,
  applyEditedText,
  groupWords,
  toEditableText,
  toVtt,
  wordCount,
  type CaptionTrack,
  type CaptionWord,
} from '../src/engine/captions';

const w = (text: string, start: number, end: number): CaptionWord => ({ text, start, end });

describe('groupWords', () => {
  it('splits on the max word count', () => {
    const words = Array.from({ length: 10 }, (_, i) => w(`w${i}`, i * 0.3, i * 0.3 + 0.25));
    const lines = groupWords(words, { maxWords: 4, gapSeconds: 5 });
    expect(lines.map((l) => l.words.length)).toEqual([4, 4, 2]);
  });

  it('starts a new line on a long silence', () => {
    const words = [w('hello', 0, 0.4), w('there', 0.45, 0.8), w('now', 2.0, 2.3)];
    const lines = groupWords(words, { maxWords: 10, gapSeconds: 0.6 });
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('hello there');
    expect(lines[1].text).toBe('now');
  });

  it('breaks after sentence-ending punctuation', () => {
    const words = [w('Done.', 0, 0.4), w('Next', 0.5, 0.8)];
    const lines = groupWords(words, { maxWords: 10, gapSeconds: 5 });
    expect(lines).toHaveLength(2);
  });

  it('sets line start/end from first/last word', () => {
    const words = [w('a', 1, 1.4), w('b', 1.5, 2.2)];
    const [line] = groupWords(words, { maxWords: 10, gapSeconds: 5 });
    expect(line.start).toBe(1);
    expect(line.end).toBe(2.2);
  });
});

describe('active lookup', () => {
  const track: CaptionTrack = {
    language: 'en',
    lines: [
      { start: 0, end: 1, text: 'first line', words: [w('first', 0, 0.5), w('line', 0.5, 1)] },
      { start: 2, end: 3, text: 'second line', words: [w('second', 2, 2.5), w('line', 2.5, 3)] },
    ],
  };

  it('finds the line active at a time', () => {
    expect(activeLineAt(track, 0.3)?.text).toBe('first line');
    expect(activeLineAt(track, 2.7)?.text).toBe('second line');
  });

  it('returns null in the gap between lines and outside the track', () => {
    expect(activeLineAt(track, 1.5)).toBeNull();
    expect(activeLineAt(track, 10)).toBeNull();
    expect(activeLineAt(track, -1)).toBeNull();
  });

  it('advances the karaoke word index over time', () => {
    const line = track.lines[0];
    expect(activeWordIndex(line, -0.1)).toBe(-1);
    expect(activeWordIndex(line, 0.1)).toBe(0);
    expect(activeWordIndex(line, 0.6)).toBe(1);
    // Holds on the last word until the line ends.
    expect(activeWordIndex(line, 0.99)).toBe(1);
  });

  it('counts words', () => {
    expect(wordCount(track)).toBe(4);
  });
});

describe('toVtt', () => {
  it('emits valid WebVTT with timestamps', () => {
    const track: CaptionTrack = {
      language: 'en',
      lines: [{ start: 1.5, end: 3.25, text: 'hello world', words: [] }],
    };
    const vtt = toVtt(track);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.500 --> 00:00:03.250');
    expect(vtt).toContain('hello world');
  });
});

// ---------------------------------------------------------------- editing

const track = (): CaptionTrack => ({
  language: 'en',
  lines: [
    { start: 0, end: 2, text: 'hello wrold', words: [w('hello', 0, 1), w('wrold', 1, 2)] },
    { start: 2, end: 4, text: 'second line', words: [w('second', 2, 3), w('line', 3, 4)] },
    { start: 4, end: 6, text: 'third line', words: [w('third', 4, 5), w('line', 5, 6)] },
  ],
});

describe('toEditableText', () => {
  it('renders one caption per row', () => {
    expect(toEditableText(track())).toBe('hello wrold\nsecond line\nthird line');
  });

  it('round-trips unchanged text', () => {
    const t0 = track();
    const t1 = applyEditedText(t0, toEditableText(t0));
    expect(t1.lines.map((l) => l.text)).toEqual(t0.lines.map((l) => l.text));
    expect(t1.lines.map((l) => [l.start, l.end])).toEqual(t0.lines.map((l) => [l.start, l.end]));
  });
});

describe('applyEditedText', () => {
  it('keeps every timing when the row count is unchanged', () => {
    const t1 = applyEditedText(track(), 'hello world\nsecond line\nthird line');
    expect(t1.lines[0].text).toBe('hello world');
    expect(t1.lines.map((l) => [l.start, l.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it('re-derives word timings inside the edited line', () => {
    const t1 = applyEditedText(track(), 'alpha beta\nsecond line\nthird line');
    const words = t1.lines[0].words;
    expect(words.map((x) => x.text)).toEqual(['alpha', 'beta']);
    // Words stay inside the line and run in order, so karaoke still works.
    expect(words[0].start).toBe(0);
    expect(words[words.length - 1].end).toBeCloseTo(2);
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });

  it('drops only the blanked caption and leaves neighbours untouched', () => {
    const t1 = applyEditedText(track(), 'hello wrold\n\nthird line');
    expect(t1.lines.map((l) => l.text)).toEqual(['hello wrold', 'third line']);
    expect(t1.lines.map((l) => [l.start, l.end])).toEqual([[0, 2], [4, 6]]);
  });

  it('collapses stray whitespace', () => {
    const t1 = applyEditedText(track(), '  hello   world  \nsecond line\nthird line');
    expect(t1.lines[0].text).toBe('hello world');
  });

  it('re-spreads timing over the same span when rows are added', () => {
    const t1 = applyEditedText(track(), 'a\nb\nc\nd');
    expect(t1.lines).toHaveLength(4);
    // Still bounded by the original track, and still monotonic.
    expect(t1.lines[0].start).toBe(0);
    expect(t1.lines[3].end).toBeCloseTo(6);
    for (let i = 1; i < t1.lines.length; i++) {
      expect(t1.lines[i].start).toBeGreaterThanOrEqual(t1.lines[i - 1].end - 1e-9);
    }
  });

  it('returns an empty track when everything is deleted', () => {
    expect(applyEditedText(track(), '').lines).toEqual([]);
  });

  it('preserves the language tag', () => {
    expect(applyEditedText(track(), 'x\ny\nz').language).toBe('en');
  });

  it('keeps the edited track renderable and exportable', () => {
    const t1 = applyEditedText(track(), 'hello world\nsecond line\nthird line');
    expect(activeLineAt(t1, 0.5)?.text).toBe('hello world');
    expect(wordCount(t1)).toBe(6);
    expect(toVtt(t1)).toContain('hello world');
  });
});
