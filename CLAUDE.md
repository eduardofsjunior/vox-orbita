# CLAUDE.md — working notes for AI assistants

Read this first. It captures the invariants and gotchas that are expensive to
rediscover. For the full design rationale see [ARCHITECTURE.md](ARCHITECTURE.md).

## What this is

**Vox Orbita** — a 100% client-side studio that turns voice notes and podcasts
into MP4 videos with audio-reactive visuals. No backend, no uploads, no
accounts. TypeScript (strict) + Vite, vanilla DOM, Canvas 2D + raw WebGL2
(no three.js), WebCodecs for export, Whisper via transformers.js for captions.

## Commands

```bash
npm run dev        # studio at localhost:5173
npm run build      # tsc --noEmit && vite build  (also the typecheck gate)
npm test           # Vitest — engine unit tests (tests/*.test.ts)
npm run e2e        # Playwright — builds, serves on :4173, runs e2e/*.spec.ts
npm run typecheck  # tsc --noEmit alone
```

`npm run e2e` reuses a server on :4173 if one is already running. If a stale
`vite preview` is left over, kill it or Playwright will test old code.

## The one rule that matters: determinism

**Frame N must be a pure function of `(N, config, FeatureTrack, AudioSource,
theme, captions)`.** Preview and export share `Compositor.renderFrame`, and an
e2e test asserts they produce byte-identical PNGs. If you break this, exports
silently stop matching what the user previewed.

Concretely, inside any layer's `render()`:

- ❌ No `Math.random()`, `Date.now()`, `performance.now()`.
- ❌ No state that accumulates across frames (no "particles array" you mutate).
- ✅ Randomness comes from seeded hashes in `src/engine/prng.ts`
  (`hash01`, `hash2`, `mulberry32`), keyed on frame/element index.
- ✅ Motion is closed-form from `rc.time` / `rc.frame`. If something needs
  history, read it back out of the `FeatureTrack` (`frame - k * stride`) —
  that's how `vis-tunnel` and `vis-ridgeline` work.
- ✅ Per-instance caches (GL buffers, gradients) are fine — they may affect
  performance, never pixels.

Scale everything by `Math.min(rc.w, rc.h)` so 192px thumbnails and 4K exports
compose identically.

## Gotchas that have bitten before

1. **`bandsAt()` returns a shared scratch buffer for fractional frames.**
   Consume the values before calling it again; never hold two results at once.
2. **Fractional frames.** The preview passes `time * fps` *unfloored* so
   animation is smooth on high-refresh displays; export passes integers.
   Anything that indexes `features.onsets` / `features.flux` directly must
   `Math.floor(frame)` first.
3. **`previewFrameTo` vs `renderFrameTo` only match at the preview canvas's own
   resolution** (1280×720 for 16:9). Comparing across resolutions differs by
   text antialiasing — that's expected, not a bug.
4. **`testApi.exportNow()` must reset `exportDialog.lastBlob = null` first**,
   or a second export returns the stale first blob. This silently invalidated
   an entire verification pass once.
5. **WebGL context loss.** Headless Chromium (SwiftShader) drops contexts under
   load. `Compositor` recovers via `resetGL()` and catches per-layer render
   errors. `GLRenderer.dispose()` **must** call
   `WEBGL_lose_context.loseContext()` — browsers cap ~16 live contexts.
6. **`GLRenderer.setUniforms` auto-binds any 16-float `Float32Array` as a
   `mat4`.** Never pass a 16-element non-matrix array.
7. **Never sample *signed* peaks per slice** for waveform display — the sign
   flips randomly between frames and flickers violently. Use `abs` envelopes
   (see `vis-ribbon`).
8. **Export dialog is a `<dialog>`**: close it between programmatic exports or
   `showModal()` throws `InvalidStateError`.

## Audio pipeline order

```
sourceAudio (immutable)
  → timeline edits   (trim, silence removal, fades, music bed)   audio-edit.ts
  → effects chain    (filter/EQ/comp/pitch/…)                    audio-fx.ts
  → loudness         (ITU-R BS.1770 normalize — LAST, so the
                      delivered file actually hits its target)   audio-edit.ts
  → computeFeatures  (FeatureTrack the visuals read)             features.ts
```

All of it runs in `src/ui/audiofx.worker.ts` off the main thread, **always
restarting from `sourceAudio`** so edits/effects are never cumulative. All DSP
is plain `Float32Array` math — no Web Audio, no `OfflineAudioContext` — so it
is byte-identical across browsers and unit-testable in Node.

`App.applyPipeline()` runs it; `App.schedulePipeline()` is the debounced
version used by controls.

## Adding things

- **A visualizer / background / overlay**: write `src/engine/layers/<id>.ts`
  using `defineLayer({ id, kind, schema, render })`, then add it to
  `src/engine/registry.ts`, then add `layer.<id>` + any new `cfg.<key>` labels
  to **both** locales in `src/i18n.ts`. The controls panel, thumbnails and
  project format pick it up automatically — zero UI code.
- **An audio effect**: add to `EFFECTS` in `src/engine/audio-fx.ts` (pure
  function `(channels, sampleRate, cfg) => channels`, never mutate the input),
  plus `fx.<id>` labels.
- **A schema field kind** is one of: `slider | color | toggle | select | text |
  image`. Labels resolve from `cfg.<key>`; select options from `opt.<value>`.

Nested plain-object config (like `edits.silence`) can be fed straight to
`buildControls` — that's how the Edit tab is rendered with no bespoke widgets.

## Project file format

`serializeProject` / `deserializeProject` in `src/engine/project.ts`.
`FORMAT_VERSION` is currently **5**. Loaders migrate older files:

| v | added |
|---|---|
| 1 | single `visualizer` |
| 2 | `visualizers[]` with per-instance `placement` |
| 3 | audio `effects` chain |
| 4 | `captions` track |
| 5 | per-scope `themes` + timeline `edits` |

**Always bump the version and add a migration** when changing the shape; there
are round-trip + migration tests in `tests/project.test.ts`.

## Themes

Palettes are per **scope**: `app | background | visualizer | overlay`
(`THEME_SCOPES` in `engine/types.ts`). `buildStack()` attaches each layer's
scope palette to its `StackEntry.theme`; the compositor swaps `rc.theme` per
layer. The `app` scope drives the CSS `--accent` via `applyAppTheme()`.

## Verification workflow

Don't declare visual work done from code alone. Render frames and *look* at
them: `window.__vox` (see `App.testApi`) exposes `loadDemo`, `hasFeatures`,
`renderFrameTo(frame, w, h)`, `previewFrameTo`, `setVisualizers`, `setEdits`,
`audioInfo`, `applyFxPreset`, `setCaptions`, `setThemeScope`, `exportNow`.
Drive it from a short Playwright script, write a PNG, and read the image.

Keep temp scripts as `*.tmp.mjs` in the repo root (gitignored) and delete them
when done.
