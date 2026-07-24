# Pixel-art loop prompts (Higgsfield / any image model)

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

### Reusable suffix — append to every prompt

> Sprite sheet layout: exactly 4 columns by 3 rows, 12 total frames, read
> left to right then top to bottom. Each cel is 480x270 pixels, 16:9. Every
> cel shows the SAME scene from the SAME fixed camera — only the animated
> elements move. Frame 12 must flow seamlessly back into frame 1 (perfect
> loop). Consistent limited palette of 20 colours across all frames. Crisp
> pixel-art with hard edges, no anti-aliasing, no blur, no gradients except
> deliberate dithering. No text, no watermarks, no frame borders or gutters,
> no drop shadows outside the art. Flat 2D side view.

### After generating
1. Check the grid is exact (crop if the model adds margins — gutters break it).
2. In Vox Orbita: **Background → Pixel loop → Choose image**, set Columns/Rows/
   Frames, keep **Pixelated** on.
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
