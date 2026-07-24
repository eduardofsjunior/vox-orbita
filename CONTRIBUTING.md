# Contributing to Vox Orbita

Thanks for helping! The most common contribution is a new visualizer or
background preset — that path is deliberately friction-free.

Before diving in, skim [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces
fit together and [CLAUDE.md](CLAUDE.md) for the invariants and known gotchas
(both are short, and the determinism contract below is the important part).

## Setup

```bash
npm install
npm run dev       # studio at http://localhost:5173
npm test          # engine unit tests
npm run typecheck
npm run e2e       # full export smoke test (needs npx playwright install chromium)
```

## Authoring a preset (zero UI code)

A preset is a `LayerDef`: an id, a kind, a config **schema**, and a `render`
function. The controls panel, preset gallery, project serialization and i18n
labels are all derived from the schema — you never touch UI code.

1. Create `src/engine/layers/vis-myidea.ts`:

```ts
import { bandsAt, beatAt } from '../types';
import { defineLayer, resolveColor } from './api';

export const visMyIdea = defineLayer({
  id: 'vis-myidea',            // stable, kebab-case, prefixed by kind
  kind: 'visualizer',          // 'background' | 'visualizer' | 'overlay'
  schema: {
    color:  { kind: 'color',  def: 'theme:a' },
    height: { kind: 'slider', min: 0.1, max: 1, step: 0.01, def: 0.5 },
    pulse:  { kind: 'toggle', def: true },
  },
  render(rc, cfg) {            // cfg is fully typed from the schema
    const bands = bandsAt(rc.features, rc.frame);   // 64 values, 0..1
    const beat = beatAt(rc.features, rc.frame);     // 1 on onset, decays
    rc.c2.fillStyle = resolveColor(cfg.color, rc.theme);
    // ... draw with rc.c2 (2D) or rc.glr (WebGL2) ...
  },
});
```

2. Register it in `src/engine/registry.ts` (one import + one array entry).
3. Add display names to `src/i18n.ts`: `'layer.vis-myidea': 'My idea'` in both
   `en` and `ptBR`. Config labels come from the shared `cfg.*` keys — add new
   ones only for keys that don't exist yet.

That's it. The preset shows up in the gallery with a live thumbnail, its
controls are auto-generated, and it round-trips through project files.

### The determinism contract (required)

Preview and export must render **pixel-identical** frames. Therefore a layer's
`render(rc, cfg)` must be a pure function of its inputs:

- **No `Math.random()`, no `Date.now()`, no accumulated state.** Use
  `hash01`/`hash2`/`mulberry32` from `src/engine/prng.ts`, seeded by frame or
  element indices.
- **No simulation.** If something moves, express its position in closed form
  from `rc.time` / `rc.frame` (see `vis-particles.ts` for damped motion
  integrated analytically).
- **Read audio only via `rc.features` (per-frame matrix) or `rc.audio`
  (raw PCM indexed from `rc.frame / rc.fps`).** Never from a live
  AnalyserNode.
- Scale sizes by `Math.min(rc.w, rc.h)` so 360p thumbnails and 4K exports have
  the same composition.

Per-instance caches (GL buffers, gradients) are fine — put them in the
optional `init()` state. They must affect performance only, never pixels.

### Field kinds

| kind | value type | UI |
| --- | --- | --- |
| `slider` | `number` | range + live readout (`min/max/step/unit`) |
| `color` | `'#rrggbb'` or `'theme:a\|b\|c\|bg'` | theme swatches + custom picker |
| `toggle` | `boolean` | switch |
| `select` | `string` | dropdown (labels from `opt.<value>` i18n keys) |
| `text` | `string` | text input |
| `image` | `ImageRef \| null` | file picker (serialized by file name) |

## Code style

- TypeScript strict; no `any` in engine code.
- The engine (`src/engine`) must stay framework-free and runnable in a worker:
  no DOM globals beyond canvas contexts handed to it.
- Comments explain constraints and invariants, not what the next line does.

## Tests

- Engine changes need Vitest coverage (`tests/`). Analysis code must be
  deterministic — there's a bit-identity test that will catch you if not.
- UI/flow changes should keep `npm run e2e` green.

## Releasing

`npm run build` produces a static `dist/` with relative asset paths — deploy
anywhere (GitHub Pages, Vercel, Netlify, a USB stick).
