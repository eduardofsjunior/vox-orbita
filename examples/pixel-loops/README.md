# Example pixel-loop sprite sheets

Six ready-to-use sprite sheets generated with Higgsfield (`nano_banana_pro`,
2k, 16:9) from the prompts in
[docs/pixel-art-prompts.md](../../docs/pixel-art-prompts.md). Not tracked in
git (binary assets) — copy what you want, or regenerate your own.

**v2 (current):** regenerated with explicit frame-to-frame continuity
instructions after the first batch looked "hit or miss" — some panels didn't
connect smoothly to their neighbors. Every file here now reads as one
continuous motion cycle, not independently-varied panels.

Load one in the studio: **Background → Pixel loop → Choose image**, then set
**Columns / Rows / Frames** exactly as listed below (the grid the model
actually drew doesn't always match the requested 4×3 — use the real numbers).

| File | Grid | Frames | Recommended `Advance` | Notes |
|---|---|---|---|---|
| `solarpunk-particles_4x4-16f.png` | 4×4 | 16 | Time | Motes drift in one continuous current |
| `dog-tailwag_4x3-12f.png` | 4×3 | 12 | Beat | Clean pendulum wag, true loop |
| `eagle-vista_4x4-16f.png` | 4×4 | 16 | Time | Head does a full round-trip turn; tiny background blip on the very last frame (barely noticeable) |
| `rain-window_4x4-16f.png` | 4×4 | 16 | Time | Puddle ripples cycle cleanly |
| `bioluminescent-forest_4x3-12f.png` | 4×3 | 12 | Energy | Glow does a full breathe in/out — best loop of the six |
| `solarpunk-city_4x4-16f.png` | 4×4 | 16 | Time | Tram/airship glide continuously along the elevated track |

Set **Frame rate** to 8–10 and keep **Pixelated** on. Frame count higher than
requested just means a slightly longer loop (16 @ 10 fps = 1.6 s) — not a
problem.

## What worked / didn't (for next time)

- `nano_banana_pro` mostly ignores the exact "4 columns × 3 rows" instruction
  and drew a **4×4** grid instead for most prompts — harmless, just read the
  real grid off the image and set Columns/Rows/Frames to match. This did not
  improve between v1 and v2; treat it as a model quirk to work around, not a
  prompt bug to keep chasing.
- **Grid uniformity** (no oversized "hero" panel) is reliably fixed by
  explicit **"uniform comic-book contact sheet, all panels exactly the same
  size, no splash panel, no hero panel"** language. Avoid cinematic/epic
  phrasing, which nudges the model toward a splash-panel layout.
- **Frame-to-frame continuity** (this round's fix) needed a different kind of
  instruction than grid uniformity: describe the panels explicitly as
  *consecutive frames of one continuous animation, like a traditional
  hand-drawn exposure sheet or filmstrip*, where **panel N is the in-between
  step after panel N-1 and before panel N+1** — small, smooth, constant-speed
  change only. Without this the model tends to draw each panel as an
  independent variation on the scene, which is exactly the "doesn't look
  continuous" complaint.
- **One-way motion breaks the loop.** A motion described only as "turns from
  A to B" will do exactly that — one-way — so panel 12 wrapping back to
  panel 1 shows a visible snap. Say explicitly that the motion is a **full
  round-trip cycle within the sheet** (e.g. "turns toward the viewer through
  the middle panels, then turns back to the start pose by the last panel") for
  anything that isn't naturally cyclic (tail wags and breathing glows loop for
  free; head turns and camera pans don't, unless you ask for the round trip).
- One eagle attempt was flagged by the content filter for no apparent reason
  (a bird on a mountain, "seen from behind") — a false positive. Rewording the
  camera angle ("three-quarter angle from behind its shoulder" instead of
  "seen from behind") and appending "Family-friendly wildlife nature
  illustration" cleared it on retry.
- Cost: ~2 credits per `nano_banana_pro` generation at 2k. This round used 7
  generations (1 retry for continuity, 1 retry for the content-filter flag,
  1 retry for the one-way-motion fix) — budget ~2-3 attempts per asset when
  chasing a specific defect.

---

## São Paulo / cyberpunk / enclosed-space sets (v3, added 2026-07-27)

40 more sheets generated from the brief at
`C:\Projetos\brain\03 Resources\Vox Orbita — Sao Paulo Pixel Loops.md`
(`nano_banana_pro`, 2k). Two formats: **9:16 vertical** (mobile) and **16:9
widescreen** (desktop). Every sheet is **4×4 / 16 frames** except
`liberdade-torii_cyberpunk_2x4-8f.png`, which is **2×4 / 8 frames** — the
filename always records the grid the model actually drew, so read it off the
name. Set **Frame rate 4** (≈4 s loop) and keep **Pixelated** on.

> ### ⚠️ Set **Sheet format → Format B** for every sheet in this section
>
> These are model-generated *contact sheets*: a border around the grid, thin
> divider lines between cels, and a grid that is usually a few pixels out of true.
> Slicing them by exact even division (**Format A**) catches the divider plus a
> sliver of the neighbouring cel along the top and left edge — it shows up as a
> thin mismatched strip across the top of the background.
>
> **Format B** trims a margin off each cel so only its interior is sampled, which
> removes the strip. The **Cel trim** slider beside it defaults to 6%, enough for
> almost everything here. Two exceptions:
> - `dungeon-gym_enclosed_4x4-16f.png` (the 9:16 one) has an unusually large
>   ~12% grid offset — push **Cel trim** to ~13% for that one.
> - The six original example loops at the top of this README tile edge to edge
>   with no border, so leave those on **Format A**.
>
> Trimming does crop a little real content, but under a visualizer that is far
> less noticeable than the seam it removes.

### Cyberpunk São Paulo — 9:16 (`*_cyberpunk_4x4-16f.png`)

| File | Advance | Notes |
|---|---|---|
| `avenida-paulista_cyberpunk_4x4-16f.png` | Time | MASP red stilts + wave paving intact; billboard alternates hue each frame |
| `edificio-copan_cyberpunk_4x4-16f.png` | Time | Drones on a clean closed loop past the wavy facade |
| `minhocao_cyberpunk_4x4-16f.png` | Beat | Best jogger cycle of the vertical set |
| `viaduto-do-cha_cyberpunk_4x4-16f.png` | Time | Lamp breathing pulse; slight scale drift on the last row |
| `praca-da-se_cyberpunk_4x4-16f.png` | Time | **Weakest loop** — pigeons read as independent variations. Raise Dim, or set Frames to 8 |
| `estacao-da-luz_cyberpunk_4x4-16f.png` | Time | Train recedes down the platform, genuinely continuous |
| `ponte-estaiada_cyberpunk_4x4-16f.png` | Time | X-pylon unmistakable, cable data-pulses |
| `liberdade-torii_cyberpunk_2x4-8f.png` | Time | **Columns 2 / Rows 4 / Frames 8.** Subtle lantern idle |
| `skyline-deck_cyberpunk_4x4-16f.png` | Time | Dense concrete-tower skyline, flying vehicles |
| `beco-do-batman_cyberpunk_4x4-16f.png` | Time | Glitch/AR overlay flickers on one mural |

### Enclosed spaces — 9:16 (`*_enclosed_4x4-16f.png`)

`dungeon-gym` (Beat — swinging bulb sweeps shadows, **best of this set**),
`limestone-cave` (Time — drip → ripple → still pool, textbook cycle),
`boxing-basement` (Beat), `warehouse-gym` (Beat — very subtle),
`stone-dungeon` (Time — torch flicker), `parking-garage` (Time — tube flicker),
`stark-basement` (Time — dust motes, subtle), `mine-shaft` (Time — cart pass),
`bunker` (Time — **slow** light swell, deliberately not a strobe),
`boiler-room` (Energy — furnace glow).

### São Paulo locations — 9:16 (`*_sp_4x4-16f.png`)

`rooftop-laje-gym` (Beat — rings/chain over the skyline at sunrise),
`minhocao-sunday` (Beat), `ibirapuera-bars` (Beat), `pinheiros-ciclovia` (Beat),
`vale-anhangabau` (Time — fountain jets do a full rise-and-fall round trip),
`zona-leste-lajes` (Time — laundry sway + tank drip),
`interlagos-overlook` (Beat), `minhocao-underside` (Time — steam plume).

### Widescreen / desktop — 16:9 (`*-wide_4x4-16f.png`)

Cyberpunk SP: `skyline-deck`, `avenida-paulista`, `minhocao`, `ponte-estaiada`,
`vale-anhangabau`, `edificio-copan`, `estacao-da-luz`.
Enclosed: `dungeon-gym`, `stone-dungeon-hall`, `limestone-cave`,
`boxing-basement`, `mine-shaft`.

Best of the widescreen set: **`limestone-cave_enclosed-wide`** (cleanest loop of
the whole session), **`estacao-da-luz_cyberpunk-wide`** (maglev light-trail),
**`edificio-copan_cyberpunk-wide`** (neon tracing the real facade grooves).

Two caveats:
- `skyline-deck_cyberpunk-wide_4x4-16f.png` is **2752×1404, not 2752×1536** — the
  model added its own title and footer text bands, which would have broken the
  even-division slicing, so they were cropped off. Cel is 688×351; it divides
  evenly and loads as-is.
- `mine-shaft_enclosed-wide_4x4-16f.png` draws an oval vignette inside each cel
  rather than filling it. It slices correctly and reads as a deliberate rounded
  viewport, but it's not what was asked for.

## What worked / didn't — v3 update (supersedes one claim above)

- **The 4×4 grid drift is fixable — the note above calling it "a model quirk to
  work around, not a prompt bug to keep chasing" was wrong.** Asking for "4
  columns × 3 rows" constrains the *grid* but never the *panel*, so the model is
  free to satisfy "12 panels" with any tiling — in this round two sheets came back
  as **2×6** and **2×4** with landscape cels, which ruins a 9:16 mobile sheet.
  Naming the panel's own shape fixes it:

  > Each individual panel must itself be a TALL VERTICAL PORTRAIT rectangle,
  > clearly taller than it is wide, about 9:16 proportions per panel. Do NOT draw
  > 2 columns. Do NOT draw wide landscape panels.

  **32/32 sheets generated after adding this came out as a correct 4×4**, in both
  aspect ratios (invert to "WIDE LANDSCAPE … about 16:9 per panel" for 16:9).
  This is the single highest-value line to keep in the suffix.
- **Lock the palette explicitly.** "The colour palette must be IDENTICAL across
  all panels — hue and saturation locked; only brightness may pulse; hue must not
  drift." Fixed the cyan→pink leaf drift seen in the first batch; no palette drift
  in 40 sheets.
- **Forbid sheet furniture.** Add "no title bars, no header or footer text of any
  kind" and "each panel's artwork must fill its entire rectangular panel edge to
  edge — no oval or rounded vignette, no dark masked corners." One sheet each
  violated these before the negatives were added; both later sheets were clean.
- **Pin in-scene signage.** For scenes with billboards/holograms/signs, say "the
  sign content must NOT change from panel to panel, only pulse in brightness" —
  otherwise the model re-rolls the artwork each frame and it reads as a strobe.
- **"Cinematic"/"epic" is still poison** even for widescreen, where it's the
  natural word. Use "widescreen" / "broad horizontal" — 12/12 widescreen sheets
  came out with uniform panels and no splash panel.
- **Closed-loop motion works better than round trips.** "Exits the frame at one
  edge and re-enters at the other, position advancing by a small equal step in
  every panel" produced the most convincing loops (trains, cyclists, joggers,
  carts, drones). Prefer it over a round trip wherever the subject can travel.
- **Cost:** 41 generations for 40 accepted sheets — only one retry needed, versus
  the "budget 2–3 attempts per asset" from the previous round. The panel-shape fix
  is why. A defect that's cheap to fix in post (the stray title bands) was cropped
  with ffmpeg rather than regenerated.
