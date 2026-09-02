# Pixel-art loop prompts (Higgsfield / any image model)

> **v3 update (2026-07-27) — read this before using the v2 suffix below.**
> A 40-sheet run (São Paulo / cyberpunk / dungeon sets, 9:16 and 16:9) found
> three things the v2 suffix is missing. Full write-up in
> [examples/pixel-loops/README.md](../examples/pixel-loops/README.md).
> 1. **Name the panel's own shape, not just the grid.** "4 columns × 3 rows"
>    constrains the grid but not the panel, so the model satisfies "12 panels"
>    with any tiling — two sheets came back 2×6 and 2×4 with landscape cels.
>    Adding *"each individual panel must itself be a TALL VERTICAL PORTRAIT
>    rectangle, clearly taller than it is wide, about 9:16 per panel; do NOT draw
>    2 columns, do NOT draw wide landscape panels"* gave **32/32 correct grids**.
>    Invert to "WIDE LANDSCAPE … about 16:9 per panel" for 16:9 sheets. This
>    supersedes the v2 note that grid drift is an unfixable model quirk.
> 2. **Lock the palette:** *"the colour palette must be IDENTICAL across all
>    panels — hue and saturation locked; only brightness may pulse; hue must not
>    drift."* Kills the colour drift seen in the first batch.
> 3. **Forbid sheet furniture:** no self-generated title/footer bands (they break
>    even-division slicing), no per-cel oval vignette, and pin in-scene signage
>    content so it pulses instead of re-rolling each frame.
>
> Also: a **4×4 grid works in either aspect ratio** — sixteen 9:16 cels tile into
> a 9:16 sheet and sixteen 16:9 cels tile into a 16:9 sheet, no extra maths.
> And prefer **closed-loop travel** ("exits one edge, re-enters the other,
> advancing an equal step each panel") over round trips where the subject can
> move — it produced the most convincing loops by a wide margin.

> **v2 update (continuity pass):** the first batch of six sheets in
> [examples/pixel-loops/](../examples/pixel-loops/) looked "hit or miss" —
> some panels didn't connect smoothly to their neighbors, because asking for
> "the same scene, only animated elements move" lets the model draw each
> panel as an *independent variation* rather than a true next-frame. Fixed by
> describing the panels explicitly as **consecutive frames of one continuous
> animation** (like a traditional exposure sheet), where panel N must be the
> in-between step after N-1 and before N+1 — small, smooth, constant-speed
> change only. Also: a motion described as only "turns from A to B" is
> one-way, so it **snaps** when the loop wraps from the last panel back to the
> first — say explicitly that it's a **full round-trip cycle within the
> sheet** unless the motion is naturally cyclic (a tail wag or a breathing
> glow loops for free; a head turn or a camera pan doesn't). The updated
> reusable suffix below has both fixes baked in. See
> [examples/pixel-loops/README.md](../examples/pixel-loops/README.md) for the
> full list of what worked and didn't across both passes, including the grid
> count (still often 4×4 instead of the requested 4×3 — harmless, just read
> the actual grid off the image) and the "hero panel" fix (uniform contact
> sheet + no cinematic/epic phrasing).

Prompts for generating animated pixel-art backgrounds for the **Pixel loop**
(`bg-sprite`) background. Read the spec first — the prompts assume it.

---

## The technical spec (don't skip this)

`bg-sprite` takes **one image** containing a grid of frames read
**left→right, top→bottom**, and plays them as a loop.

| Setting | Recommended | Why |
|---|---|---|
| Grid | **4 columns × 3 rows = 12 frames** | Best balance; set `Columns 4`, `Rows 3`, `Frames 12` |
| Cel size | **480 × 270 px** (16:9) | Sheet = 1920 × 810. Upscaled with nearest-neighbour, so small is correct |
| Frame rate | **8–12 fps** | Set in the layer's `Frame rate` |
| Palette | **16–24 colours, fixed** | The #1 thing that makes it read as real pixel art |

**On frame count** — you guessed 20 and wondered if fewer was better: fewer *is*
better. Hand-made pixel art loops usually run **8–16 frames at 8–12 fps**. The
slight choppiness is the aesthetic, not a limitation. **12 frames @ 10 fps =
1.2 s loop** is the sweet spot. Use 8 for simple idles (a tail wag, drifting
clouds), 16 only for something with real motion arcs. Above ~16 you're paying
for frames nobody perceives.

**Vertical (9:16) projects**: use 3 cols × 4 rows, cels 270 × 480.

### Making it loop seamlessly
Always end the prompt with the loop instruction below. If your model won't
produce a clean cycle, generate an **even** frame count and mirror it in the
app by setting `Frames` to half — or ask for a "ping-pong" motion (out and
back), which loops by construction.

### Reusable suffix v2 — append to every prompt

Two parts: describe the scene AND its motion first (including whether the
motion is naturally cyclic or needs an explicit round-trip — see the note
above), then append this layout block:

> Sprite sheet layout: a uniform comic-book contact sheet grid of exactly 12
> equally-sized panels, 4 across and 3 down. ALL PANELS EXACTLY THE SAME SIZE
> — no panel larger than any other, no splash panel, no hero panel. Panels
> read left to right then top to bottom as CONSECUTIVE FRAMES OF ONE
> CONTINUOUS ANIMATION, like a traditional hand-drawn animation exposure
> sheet or a filmstrip: each panel is the very next in-between step after the
> previous one and the step immediately before the next one. The change from
> one panel to the next must be small, smooth and constant in speed — no
> jumps, no skipped motion, no panel that looks unrelated to its neighbors.
> Panel 12 must be the in-between step that flows seamlessly back into panel
> 1, completing one continuous loop with no visible seam. Every panel shows
> the exact SAME scene from the exact SAME fixed camera and framing —
> background, composition and lighting identical in all 12 panels; only the
> specifically animated element(s) move. Consistent limited palette of 20
> colours across all panels. Crisp pixel-art, hard edges, no anti-aliasing,
> no blur, no gradients except deliberate dithering. No text, no watermarks,
> no numbers, thin flat divider lines only, no drop shadows outside the art.
> Flat 2D side view.

If a generation gets flagged by the content filter for no apparent reason,
try rewording the camera framing (e.g. "three-quarter angle from behind its
shoulder" instead of "seen from behind") and append "Family-friendly
[wildlife/whatever] illustration" — worked on the first retry when this
happened with the eagle.

### After generating
0. **Set `Sheet format` to `Format B`** in the Pixel loop layer. Model-generated
   sheets are contact sheets — border around the grid, divider lines between
   cels, grid a few pixels out of true — so exact even division (`Format A`)
   slices in the divider and a sliver of the next cel along the top/left edge.
   Format B trims each cel to its interior; the `Cel trim` slider (default 6%)
   controls how much. Use `Format A` only for edge-to-edge sheets with no border.
1. Check the actual grid the model drew (often 4×4, not the requested 4×3)
   and note it — you'll need the real numbers in step 2.
2. In Vox Orbita: **Background → Pixel loop → Choose image**, set Columns/Rows/
   Frames to the REAL grid, keep **Pixelated** on.
3. Set **Advance** to `Beat` to step one frame per detected beat (the dog wags
   on the downbeat), or `Energy` to speed up as the track gets louder.
4. Because it's a *background*, keep it low-contrast and dark-ish so the
   visualizer and captions stay readable — the layer's **Dim** slider helps.

---

## 1. Solarpunk particle clouds (ambient — best default)

> Pixel art animation sprite sheet. A slow drifting field of luminous pollen
> particles and soft cloud wisps floating over a distant solarpunk skyline of
> green rooftop gardens and slender white wind turbines at golden hour. Warm
> amber and teal palette, soft glowing motes rising gently upward, subtle
> parallax haze layers. Calm, hypnotic, ambient. Dark enough to sit behind
> overlaid text.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 8, Advance `Time`, Dim 0.25.

---

## 2. Cute dog wagging its tail

> Pixel art animation sprite sheet. An adorable round-faced shiba-like dog
> sitting in profile on a mossy balcony, wagging its fluffy tail in a smooth
> repeating arc and blinking once during the cycle. Behind it, a solarpunk
> garden terrace with hanging plants, small solar panels and warm evening
> light. Cozy, wholesome, chunky pixel style with thick readable shapes.
> The dog stays in the same position — only the tail, ears and eyes animate.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 10, Advance `Beat` (tail wags on the beat),
Fit `Contain` if you want the whole dog visible, Dim 0.15.

**Tip:** ask for the tail to sweep *out and back* across the 12 frames — a
ping-pong arc loops perfectly and reads as a natural wag.

---

## 3. Eagle overlooking the valley from a mountain

> Pixel art animation sprite sheet. A majestic eagle perched on a rocky
> mountain summit in the foreground right, seen from behind and slightly
> above, overlooking a vast solarpunk valley: terraced green farms, glass
> domes, elegant wind turbines and a river catching the light. The eagle
> slowly turns its head and its feathers ruffle in the wind; clouds drift
> slowly across the valley below; grass tufts sway. Epic, serene, wide
> cinematic vista at sunrise. Warm gold, deep teal and soft violet palette.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 8, Advance `Time`, Fit `Cover`, Dim 0.3
(it's a busy scene — dim it so the visualizer reads on top).

---

## 4. Rain on a solarpunk window (great for talky podcasts)

> Pixel art animation sprite sheet. Looking out through a rain-streaked
> window from a warm interior; droplets slide down the glass and ripple in
> small puddles on the sill. Outside, a blurred solarpunk street at night
> with soft glowing lanterns, vertical gardens and neon-green signage.
> Cozy lo-fi study aesthetic, muted teal and amber palette, heavy dithering
> for the blurred background. Only the raindrops and light flicker animate.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 12, Advance `Time`, Dim 0.2.

---

## 5. Bioluminescent forest canopy

> Pixel art animation sprite sheet. Looking up into a dense solarpunk forest
> canopy at night, where bioluminescent leaves and hanging vines pulse with
> soft cyan and magenta light. Glowing spores drift slowly upward through
> shafts of moonlight. Layered silhouettes create depth. Mysterious, calm,
> deep indigo background with vivid accent glows.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 8, Advance `Energy` (spores speed up on loud
passages), Dim 0.1.

---

## 6. Solarpunk city timelapse loop

> Pixel art animation sprite sheet. Wide isometric-leaning view of a
> solarpunk city: white curved towers wrapped in greenery, wind turbines
> turning slowly, small airships drifting across, trams gliding along
> elevated rails, clouds sweeping past. Everything moves in a slow
> continuous cycle. Bright optimistic daylight palette of warm white, leaf
> green, sky blue and brass.
>
> *(append the reusable suffix)*

**Layer settings:** Frame rate 10, Advance `Time`, Dim 0.35 (busiest scene).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Loop visibly jumps | Frame 12 doesn't match frame 1 — regenerate asking for ping-pong motion, or drop `Frames` to 8 |
| Blurry when scaled up | Keep **Pixelated** on; make sure the source really is low-res, not a big image styled to look pixelated |
| Frames drift / camera moves | Re-prompt with "identical fixed camera, only the animated elements move" |
| Colours shift between frames | Re-prompt with a stricter palette count, or quantize the finished sheet to 16 colours |
| Sheet has gutters/margins | Crop so the grid is exact — the layer slices by even division |
| Art fights the visualizer | Raise **Dim**, or pick a palette that contrasts with your visualizer's theme scope |
