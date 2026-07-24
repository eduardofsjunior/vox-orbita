import { describe, expect, it } from 'vitest';
import {
  defaultProject,
  defaultVisualizer,
  deserializeProject,
  exportSize,
  MAX_VISUALIZERS,
  serializeProject,
} from '../src/engine/project';

describe('project save/load', () => {
  it('round-trips a project', () => {
    const p = defaultProject();
    p.fps = 60;
    p.aspect = '9:16';
    p.resolution = 720;
    p.themes.visualizer = 'ocean';
    p.visualizers[0].config.thickness = 7;
    const text = p.overlays.find((o) => o.id === 'ov-text')!;
    (text.config as { title: string }).title = 'Hello';
    text.enabled = true;

    const { state } = deserializeProject(serializeProject(p));
    expect(state.fps).toBe(60);
    expect(state.aspect).toBe('9:16');
    expect(state.resolution).toBe(720);
    expect(state.themes.visualizer).toBe('ocean');
    expect(state.visualizers[0].config.thickness).toBe(7);
    const loadedText = state.overlays.find((o) => o.id === 'ov-text')!;
    expect(loadedText.config.title).toBe('Hello');
    expect(loadedText.enabled).toBe(true);
  });

  it('round-trips a caption track', () => {
    const p = defaultProject();
    p.captions = {
      language: 'en',
      lines: [{ start: 1, end: 2.5, text: 'hello world', words: [{ text: 'hello', start: 1, end: 1.5 }] }],
    };
    const { state } = deserializeProject(serializeProject(p));
    expect(state.captions?.lines).toHaveLength(1);
    expect(state.captions?.lines[0].text).toBe('hello world');
    expect(state.captions?.lines[0].words[0].text).toBe('hello');
    expect(state.captions?.language).toBe('en');
  });

  it('rejects non-project JSON', () => {
    expect(() => deserializeProject('{"hello":1}')).toThrow();
    expect(() => deserializeProject('[]')).toThrow();
  });

  it('clamps out-of-range slider values and ignores unknown keys', () => {
    const p = defaultProject();
    const doc = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    const vis = (doc.visualizers as Array<{ config: Record<string, unknown> }>)[0];
    vis.config.thickness = 9999;
    vis.config.bogus = 'x';
    const { state } = deserializeProject(JSON.stringify(doc));
    expect(state.visualizers[0].config.thickness).toBe(12); // schema max
    expect('bogus' in state.visualizers[0].config).toBe(false);
  });

  it('round-trips multiple visualizer instances with placement', () => {
    const p = defaultProject();
    p.visualizers.push(defaultVisualizer('vis-ribbon'));
    p.visualizers[0].placement = { x: 0.25, y: 0.7, scale: 0.5 };
    p.visualizers[1].placement = { x: 0.8, y: 0.2, scale: 1.4 };

    const { state } = deserializeProject(serializeProject(p));
    expect(state.visualizers).toHaveLength(2);
    expect(state.visualizers[1].id).toBe('vis-ribbon');
    expect(state.visualizers[0].placement).toEqual({ x: 0.25, y: 0.7, scale: 0.5 });
    expect(state.visualizers[1].placement).toEqual({ x: 0.8, y: 0.2, scale: 1.4 });
  });

  it('clamps placement into range and caps instance count', () => {
    const p = defaultProject();
    for (let i = 0; i < 10; i++) p.visualizers.push(defaultVisualizer());
    p.visualizers[0].placement = { x: 5, y: -3, scale: 99 };
    const { state } = deserializeProject(serializeProject(p));
    expect(state.visualizers.length).toBeLessThanOrEqual(MAX_VISUALIZERS);
    expect(state.visualizers[0].placement.x).toBe(1);
    expect(state.visualizers[0].placement.y).toBe(0);
    expect(state.visualizers[0].placement.scale).toBe(2);
  });

  it('migrates a v1 project (single `visualizer`) to the instance array', () => {
    const v1 = {
      app: 'vox-orbita',
      version: 1,
      fps: 30,
      aspect: '16:9',
      resolution: 1080,
      theme: 'ember',
      background: { id: 'bg-gradient', enabled: true, config: {} },
      visualizer: { id: 'vis-radial', enabled: true, config: { thickness: 6 } },
      overlays: [],
    };
    const { state } = deserializeProject(JSON.stringify(v1));
    expect(state.visualizers).toHaveLength(1);
    expect(state.visualizers[0].id).toBe('vis-radial');
    expect(state.visualizers[0].config.thickness).toBe(6);
    // Migrated instance gets a default centered placement.
    expect(state.visualizers[0].placement).toEqual({ x: 0.5, y: 0.5, scale: 1 });
  });

  it('reports missing images by file name', () => {
    const p = defaultProject();
    const doc = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    const overlays = doc.overlays as Array<{ id: string; config: Record<string, unknown> }>;
    const logo = overlays.find((o) => o.id === 'ov-logo')!;
    logo.config.image = { __voxImage: 'avatar.png' };
    const { missingImages } = deserializeProject(JSON.stringify(doc));
    expect(missingImages).toContain('avatar.png');
  });

  it('derives even export dimensions from aspect', () => {
    const p = defaultProject();
    p.aspect = '9:16';
    p.resolution = 1080;
    const { width, height } = exportSize(p);
    expect(height).toBe(1080);
    expect(width % 2).toBe(0);
    expect(width / height).toBeCloseTo(9 / 16, 1);
  });
});
