import { describe, expect, it } from 'vitest';
import {
  activeLineAt,
  activeWordIndex,
  groupWords,
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
