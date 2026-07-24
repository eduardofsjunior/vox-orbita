/**
 * Smoke test: loads the app in a real (headless) Chromium, generates the
 * built-in demo tone, runs a full export and asserts a valid, playable
 * MP4 blob comes out. Also runs an axe accessibility scan on the studio.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __vox: {
      loadDemo(): Promise<void>;
      hasFeatures(): boolean;
      setResolution(r: number): void;
      exportNow(): Promise<Blob>;
      renderFrameTo(frame: number, w: number, h: number): Promise<string>;
      previewFrameTo(frame: number): Promise<string>;
      setVisualizers(specs: Array<{ id: string; x?: number; y?: number; scale?: number }>): void;
      visualizerCount(): number;
      applyFxPreset(id: string): Promise<void>;
      audioFingerprint(): { rms: number; peak: number; length: number } | null;
      effectsEnabledCount(): number;
      setEdits(patch: Record<string, unknown>): Promise<void>;
      audioInfo(): { duration: number; outDuration: number; cuts: number; loudnessGainDb: number } | null;
      setFps(fps: number): void;
      setThemeScope(scope: string, id: string): void;
    };
  }
}

test('exports a valid MP4 from the generated demo tone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    window.__vox.setResolution(360);
    const blob = await window.__vox.exportNow();
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ftyp = String.fromCharCode(head[4], head[5], head[6], head[7]);
    // Validate the container is decodable and has the right duration.
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('exported blob failed to load as video'));
    });
    return {
      type: blob.type,
      size: blob.size,
      ftyp,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  });

  expect(result.type).toBe('video/mp4');
  expect(result.ftyp).toBe('ftyp');
  expect(result.size).toBeGreaterThan(100_000);
  expect(result.width).toBe(640);
  expect(result.height).toBe(360);
  // Demo groove is 12 s; container duration within one frame at 30 fps.
  expect(Math.abs(result.duration - 12)).toBeLessThanOrEqual(1 / 30 + 0.01);
});

test('preview and export render pixel-identical frames', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const diff = await page.evaluate(async () => {
    const [a, b] = await Promise.all([
      window.__vox.previewFrameTo(90),
      window.__vox.renderFrameTo(90, 1280, 720),
    ]);
    const load = (u: string) =>
      new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = u;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, 1280, 720).data;
    ctx.clearRect(0, 0, 1280, 720);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, 1280, 720).data;
    let differing = 0;
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) differing++;
    }
    return { differing, total: da.length };
  });
  expect(diff.total).toBe(1280 * 720 * 4);
  expect(diff.differing).toBe(0);
});

test('exports a multi-visualizer placed composition', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    // Two placed visualizers: radial top-left small, code rain full-frame.
    window.__vox.setVisualizers([
      { id: 'vis-radial', x: 0.28, y: 0.3, scale: 0.5 },
      { id: 'vis-matrix', x: 0.5, y: 0.5, scale: 1 },
    ]);
    const count = window.__vox.visualizerCount();
    window.__vox.setResolution(360);
    const blob = await window.__vox.exportNow();
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('exported blob failed to load as video'));
    });
    return { count, type: blob.type, size: blob.size, duration: video.duration };
  });

  expect(result.count).toBe(2);
  expect(result.type).toBe('video/mp4');
  expect(result.size).toBeGreaterThan(100_000);
  expect(Math.abs(result.duration - 12)).toBeLessThanOrEqual(1 / 30 + 0.01);
});

test('placed visualizer renders identically in preview and export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const differing = await page.evaluate(async () => {
    window.__vox.setVisualizers([
      { id: 'vis-radial', x: 0.7, y: 0.35, scale: 0.6 },
      { id: 'vis-linear', x: 0.3, y: 0.8, scale: 0.75 },
    ]);
    const load = (u: string) =>
      new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = u;
      });
    const [a, b] = await Promise.all([
      window.__vox.previewFrameTo(120),
      window.__vox.renderFrameTo(120, 1280, 720),
    ]);
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, 1280, 720).data;
    ctx.clearRect(0, 0, 1280, 720);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, 1280, 720).data;
    let diff = 0;
    for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
    return diff;
  });
  expect(differing).toBe(0);
});

test('audio effects transform the audio and are baked into the export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    // Export the current audio and decode channel 0 to a Float32Array.
    const decodeExport = async (): Promise<Float32Array> => {
      window.__vox.setResolution(360);
      const blob = await window.__vox.exportNow();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const ch = buf.getChannelData(0).slice();
      await ctx.close();
      document.querySelector<HTMLDialogElement>('.export-dialog')?.close();
      return ch;
    };

    await window.__vox.applyFxPreset('none');
    const cleanCount = window.__vox.effectsEnabledCount();
    const cleanFp = window.__vox.audioFingerprint()!;
    const cleanExport = await decodeExport();

    await window.__vox.applyFxPreset('robot');
    const robotCount = window.__vox.effectsEnabledCount();
    const robotFp = window.__vox.audioFingerprint()!;
    const robotExport = await decodeExport();

    // Sample-wise mean absolute difference between the two exported tracks.
    const n = Math.min(cleanExport.length, robotExport.length);
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(cleanExport[i] - robotExport[i]);
    return {
      cleanCount,
      robotCount,
      procFpDelta: Math.abs(robotFp.rms - cleanFp.rms),
      lenClean: cleanExport.length,
      lenRobot: robotExport.length,
      exportDiff: diff / n,
    };
  });

  // The preset enables effects and changes the processed audio directly.
  expect(result.cleanCount).toBe(0);
  expect(result.robotCount).toBeGreaterThan(0);
  expect(result.procFpDelta).toBeGreaterThan(0.01);
  // The effect is baked into the exported MP4 audio (same length, different signal).
  expect(result.lenRobot).toBe(result.lenClean);
  expect(result.exportDiff).toBeGreaterThan(0.02);
});

test('timeline edits change the rendered audio', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    const base = window.__vox.audioInfo()!;
    // Trim to the middle 6 s of the 12 s demo.
    await window.__vox.setEdits({ trimStart: 3, trimEnd: 9 });
    const trimmed = window.__vox.audioInfo()!;
    // Add fades + loudness normalization on top.
    await window.__vox.setEdits({ fadeIn: 0.5, fadeOut: 0.5, loudness: { enabled: true, targetLufs: -16 } });
    const normalized = window.__vox.audioInfo()!;
    return { base, trimmed, normalized };
  });

  expect(result.base.duration).toBeGreaterThan(11);
  // Trim actually shortened the rendered audio.
  expect(result.trimmed.duration).toBeGreaterThan(5.5);
  expect(result.trimmed.duration).toBeLessThan(6.5);
  expect(result.trimmed.outDuration).toBeCloseTo(6, 0);
  // Loudness normalization applied a non-zero gain.
  expect(result.normalized.loudnessGainDb).not.toBe(0);
});

test('exports at 120 fps', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    window.__vox.setFps(120);
    window.__vox.setResolution(360);
    await window.__vox.setEdits({ trimStart: 0, trimEnd: 4 }); // keep the export short
    const blob = await window.__vox.exportNow();
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('exported blob failed to load'));
    });
    return { type: blob.type, size: blob.size, duration: video.duration, height: video.videoHeight };
  });

  expect(result.type).toBe('video/mp4');
  expect(result.size).toBeGreaterThan(10_000);
  expect(result.height).toBe(360);
  expect(Math.abs(result.duration - 4)).toBeLessThan(0.2);
});

test('per-scope palettes render independently', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });

  const differs = await page.evaluate(async () => {
    window.__vox.setVisualizers([{ id: 'vis-radial' }]);
    window.__vox.setThemeScope('visualizer', 'ember');
    const a = await window.__vox.renderFrameTo(120, 320, 180);
    window.__vox.setThemeScope('visualizer', 'cyber');
    const b = await window.__vox.renderFrameTo(120, 320, 180);
    // Background scope untouched — only the visualizer palette moved.
    return a !== b;
  });
  expect(differs).toBe(true);
});

test('studio has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  // Empty state first.
  let scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  // Loaded state (full controls panel).
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForFunction(() => window.__vox.hasFeatures(), null, { timeout: 30_000 });
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  // Audio tab (effects list + presets).
  await page.getByRole('tab', { name: 'Audio' }).click();
  scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
