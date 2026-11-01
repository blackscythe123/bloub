# AGENTS.md — how to make anything with the Bloub engine

You are an AI agent (or a human) who wants to make **any** animated thing with Bloub: a still
avatar, an animated SVG for a GitHub README, a mascot that codes, sleeps, sings, a GIF, a scene
with props, a brand-new character pose. This file tells you everything you need, in the order
you need it. Read it top to bottom once. Every code snippet here has been run.

> **This repo** is [blackscythe123/bloub](https://github.com/blackscythe123/bloub), maintained by
> Simiyon Vinscent Samuel. It grew out of [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub)
> (MIT, by Jérémy Perret, whose copyright line stays in `LICENSE`) and adds a `studio/` folder of
> generators that turn the engine into README cards, expressive faces (mouths, happy / star /
> sleepy eyes, wink) with 6 expressions and 4 animations, and template cycles in the app.
> Not affiliated with x.ai.

---

## 0. Ten-second version

```bash
pnpm install            # or npm install
npx tsx studio/hello.ts # writes output/hello-still.svg and output/hello-animated.svg
```

Open `output/hello-animated.svg` in a browser. That is the whole pipeline in ~120 lines:
**drive the engine like a timeline → call `engine.sample(t)` at a fixed FPS → bake each frame's
paths into SVG `<animate>` → you get an animation that plays inside a plain `<img>`.**
Copy `studio/hello.ts` and change it. When you need props, 3D, multiple scenes or captions,
read `studio/bloub-cards.ts` (the production generator).

---

## 1. Repo map

| Path | What it is | Touch it? |
|---|---|---|
| `src/bot/` | **The engine.** Framework-free, clock-free TypeScript. | Read, import. Don't "fix" its numbers (section 9). |
| `src/bot/engine.ts` | `BotEngine`: `setState`, `setShape`, `setExpression`, `setLook`, `sample(t)` | Import |
| `src/bot/states.ts` | The 19 animation states (`StateId`, `STATES`, `STATE_BY_ID`, `SEQUENCE`, `POSES`) | Import |
| `src/bot/skins.ts` | Body shapes (`SHAPES`, `SHAPE_BY_ID`) and colours (`COLORS`, `COLOR_BY_ID`) | Import |
| `src/bot/expressions.ts` | 16 facial expressions (`EXPRESSIONS`, `EXPRESSION_BY_ID`, `blendExpression`) | Import |
| `src/bot/face.ts` | Eye geometry on a sphere, blink schedule, idle "life" (`liveliness`) | Import |
| `src/bot/traits.ts` | Face extras: mouth + happy / star / sleep eye marks (`FaceExtras`), placed from the eye centres | Import |
| `src/bot/shape.ts` | Radial profiles → paths (`closedPath`, `toPoints`, `unionOfCirclesProfile`…) | Import |
| `src/bot/cycles.ts` | Montages (timelines of states) used by the app | Import |
| `src/bot/repere.ts` | The render frame: `RAYON = 100`, `DEMI_VIEWBOX = 158` | Import |
| `src/components/BloubBot.vue` | The reference renderer (SVG layer order) | Read as a spec |
| `src/ui/export.ts`, `capture.ts`, `video.ts` | PNG / SVG / GIF / MP4 export in the app | Use via the app |
| `studio/hello.ts` | Minimal still + animated SVG | **Start here** |
| `studio/bloub-cards.ts` | Production README cards: coding, sleeping, spotify-offline (dark + light) | Read for advanced techniques |
| `studio/sphere-cards.ts` | Experiment: a fully 3D mascot made of shaded spheres (feet, paws, headphones) | Read for true-3D posing |
| `studio/palettes.json` | 30 colour palettes cycled by the cards (150 s loop) | Data |
| `docs/` | Upstream's deep docs (architecture, measurements, export, …) | Read when stuck |
| `output/` | Where studio scripts write. Git-ignored. | Generated |

Commands:

```bash
pnpm dev     # the app on http://localhost:5190 — customiser, animation editor, exports
pnpm test    # vitest, 211 tests, must stay green
pnpm build   # vue-tsc --noEmit && vite build (the only type gate)
npx tsx studio/<script>.ts   # run a generator (tsx is fetched by npx, no install needed)
```

Useful app URLs: `#planche` (all 18 catalogue states frozen side by side — **look at this before
choosing states**), `#etat=orbit&stop` (one state, paused), `#arrivee` (replay the intro).

---

## 2. The mental model (read this, it saves hours)

1. **`engine.sample(t)` is a pure function of time.** Same `t` → same frame, always. There is
   no clock, no `Date.now()`, no internal stepping. You can sample `t = 0, 1/24, 2/24, …` in a
   loop, jump backwards, sample in any order. That is what makes offline rendering trivial.
2. **External changes enter through timestamped setters.** `setState(id, now)`,
   `setExpression(expr, now)`, `setShape(radii, now)`, `setLook(look, now, morph)`. The engine
   morphs from the old value to the new one starting at `now`. **Call them in time order, at
   their own date, before sampling frames at or after that date.** (`studio/hello.ts` shows the
   loop.) Never call a setter "in the future" and then sample the past.
3. **Coordinates.** The ball has radius `RAYON = 100`. A frame lives in the square
   `[-158, 158] × [-158, 158]` (`DEMI_VIEWBOX = 158`), **y points down** (SVG convention), origin
   at the ball centre. To draw it small, wrap it in `<g transform="translate(x y) scale(k)">`.
4. **What a frame contains** (`BotFrame`):

   | Field | Meaning |
   |---|---|
   | `bodyPath` | SVG path `d` of the body. Always 64 cubic segments (`PROFILE_SAMPLES`), so any two frames morph point-for-point. |
   | `bodyAlpha` | body opacity |
   | `eyes[]` | 0–2 eyes, each `{ d, matrix, alpha }`: `d` is a capsule centred at 0,0; `matrix` is the SVG `matrix(a,b,c,d,e,f)` that places, tilts and blinks it |
   | `dots[]` | particles (thinking dots, burst) `{x, y, r, opacity, …}` or a path `d` |
   | `dotsBehind` | true → draw dots *before* the body (they pass behind it) |
   | `arcs[]` | orbit rings, already split into `back` and `front` paths + a gradient |
   | `notif`, `notch` | the blue notification pastille and its hole in the body |

5. **The eyes are holes, not shapes.** In `BloubBot.vue` the body is a `<mask>`: white body,
   black eyes. The eyes therefore show the page behind. On a transparent card you can instead
   paint the eyes with a solid ink colour on top of the body (that's what `studio/bloub-cards.ts`
   does). Both are fine; pick holes when the background is a known flat colour.
6. **Eyes live on a sphere.** Gaze is yaw/pitch/roll in degrees. That is why looking around
   reads as a real 3D head even though the body is flat. `setLook` drives it.

---

## 3. Engine API reference

```ts
import { BotEngine, type Look } from './src/bot/engine'
import { SHAPE_BY_ID, COLOR_BY_ID } from './src/bot/skins'
import { EXPRESSION_BY_ID } from './src/bot/expressions'
import { RAYON } from './src/bot/repere'

const eng = new BotEngine(
  RAYON,                                  // scale: ball radius in output units (keep 100)
  'idle',                                 // initial StateId
  SHAPE_BY_ID.get('nuage')!.radii,        // body shape (null = the state's own shape)
  EXPRESSION_BY_ID.get('heureux')!        // rest expression (null = measured default)
)
eng.setState('wink', 2.0)                 // switch state at t = 2 s (morph per state)
eng.setExpression(EXPRESSION_BY_ID.get('surpris')!, 3.0)  // morphs over 0.45 s
eng.setShape(SHAPE_BY_ID.get('cercle')!.radii, 4.0)       // morphs over 0.45 s
eng.setLook({ yaw: -20, pitch: -10, mix: 1, spin: 0, wander: 0.3 }, 5.0, 0.35)
eng.setLook(null, 6.0)                    // give the gaze back to the state
const frame = eng.sample(2.5)
```

### `Look` (where the eyes point)

| Field | Meaning |
|---|---|
| `yaw` | degrees, **absolute**, + = look right |
| `pitch` | degrees, **absolute**, + = look up |
| `mix` | 0–1, how much this target overrides the state's own gaze (1 = fully) |
| `spin` | extra degrees to travel on the way (a full head turn: eyes go behind the ball and come back) |
| `wander` | 0–1, how much of the idle gaze drift remains (0 = perfectly still stare) |

The 3rd argument of `setLook` is the catch-up duration (default 0.24 s). Non-finite values are
refused (the engine keeps the previous target).

### States (`StateId`) — look at `#planche` to see them

| id | in short | `baseBody`/`baseFace` |
|---|---|---|
| `idle` | rest pose; gaze drift and blinks are the life | ✔ / ✔ (your shape + expression apply) |
| `thinking` | three dots pulse out of the body | ✘ / ✘ |
| `wink` | a wink | ✔ / ✘ |
| `wide` | wide-open eyes | ✔ / ✘ |
| `alert` | the body becomes a travelling "!" | ✘ / ✘ |
| `notify` | a blue notification pastille pops on the outline | ✔ / ✘ |
| `exclaim` | "!" with collapse and recomposition | ✘ / ✘ |
| `sleep` | sleeping pose | ✘ / ✘ |
| `egg` | egg silhouette | ✘ / ✘ |
| `hexagon` | hexagon silhouette | ✘ / ✘ |
| `play` | play-triangle silhouette | ✘ / ✘ |
| `orbit` | 3D rings orbit around the ball (back halves drawn behind) | ✘ / ✘ |
| `burst` | body bursts into particles and recomposes | ✘ / ✘ |
| `comet` | a dot with an orbiting trail | ✘ / ✘ |
| `typing` | fast little bobs, Focused face looking down | ✔ / ✘ |
| `cheer` | crouch, jump, squash on landing, Joyful face (`minDuration` 1.6 s) | ✔ / ✘ |
| `sing` | sways side to side on a beat, Singing face, mouth pulsing | ✔ / ✘ |
| `doze` | nods, yawns wide, falls asleep and breathes (`minDuration` 3.6 s) | ✔ / ✘ |
| `swirl` | UI entry transition, not part of `SEQUENCE` | ✔ / ✔ |

- `baseBody` ✔ → your `setShape` replaces the body. ✘ → the silhouette *is* the animation.
- `baseFace` ✔ → your `setExpression` applies. Only `idle` (and `swirl`).
- `STATE_BY_ID.get(id).morph` = entry morph duration; `.duration` = natural hold time;
  `.minDuration` = don't cut it shorter or the animation never resolves.
- `POSES[id]` = the local time where a state reads best (use it for thumbnails / stills).
- **Montage rule (from upstream):** hold or cut a state, never scale its time.

### Shapes (`SHAPE_BY_ID`)

`cercle` (the original ball), `galet` (pebble), `squircle`, `capsule`, `triangle`,
`hexagone`, `nuage` (cloud — the mascot used in `studio/`), `goutte` (drop).
Each is `{ id, radii: number[64] }`: a radius per angle, 1 ≈ the ball.

### Colours (`COLOR_BY_ID`)

`encre` `#0a0a0c` (the original black), `brun`, `rouge`, `orange`, `ambre`, `vert`,
`turquoise`, `bleu`, `violet`, `rose`, `gris`, `creme`. Or use any hex: colour is just the
`fill` you give the body.

### Expressions (`EXPRESSION_BY_ID`)

`neutre`, `attentif`, `surpris`, `excite`, `heureux`, `hilare`, `colere`, `triste`, `effraye`,
`mefiant`, `confus`, `curieux`, `fier`, `timide`, `blase`, `somnolent`, and the expressive ones:
`joyeux` (Joyful), `etoile` (Starstruck), `clin` (Cheeky wink), `chante` (Singing), `endormi`
(Asleep), `concentre` (Focused).

### Face extras (`src/bot/traits.ts`)

An expression (or a state's `Pose`) can carry `face?: FaceExtras`:

```ts
face: {
  mouth: { smile: 0.9, open: 0.5, w: 0.16 },  // rounded "D" mouth; open 0 = a smile line
  happy: [1, 1],                               // per-eye weight of the round "∩" arc
  star: [0, 0],                                // per-eye weight of the sparkle
  sleep: [0, 0]                                // per-eye weight of the "‿" arc
}
```

They blend like everything else (missing = 0), the capsule eye fades by the sum of its weights
(so a wink is `happy: [0, 1]`), and `sample()` returns them as `frame.mouth` and `frame.marks`,
placed from the eye centres so they follow gaze, roll and squash. `BloubBot.vue` draws them as
holes in the body mask, exactly like the eyes. In the animated-SVG export only the eyes animate
(mouth and marks stay on the first frame); PNG / GIF / MP4 render every frame.

An expression is plain data — make your own:

```ts
import type { BotExpression } from './src/bot/expressions'
const SHUT: BotExpression = {
  id: 'somnolent',                       // must be an existing id (typing), the data is yours
  gaze: { yaw: 4, pitch: -16, roll: -4 }, // where the face points at rest
  split: 16,                              // half-distance between the eyes, degrees on the sphere
  eyes: [
    { w: 0.24, h: 0.42, tilt: 0, open: 0 }, // w/h in ball units; open 0 = closed (blink squash)
    { w: 0.24, h: 0.42, tilt: 0, open: 0 }
  ]
}
```

`tilt` is in degrees, mirrored per eye by the built-ins (`pair(w, h, tilt)`). **Mirrored tilts
read as angry or evil on a cute character** — see section 8.

### Custom body shapes

```ts
import { unionOfCirclesProfile, profileFromPolygon, superellipseProfile, hullOfCircles } from './src/bot/shape'
const blob = unionOfCirclesProfile([{ x: -0.4, y: 0.2, r: 0.55 }, { x: 0.4, y: 0.2, r: 0.5 }, { x: 0, y: -0.3, r: 0.5 }])
eng.setShape(blob, 0)   // 64 radii: works with every morph and every eye fit
```

Any new shape must be a 64-sample radial profile (`profileFromPolygon` for polygons). Then it
morphs to and from every other shape for free.

### Idle life and blinks without an engine

`liveliness(t, { wander, blink, float })` from `face.ts` returns `{ dYaw, dPitch, dRoll, lid,
driftX, driftY, breath }` — deterministic. Use it to give *your own* rig (props, a 3D body)
the same breathing and blink rhythm as the engine.

---

## 4. Rendering a frame (static SVG)

Layer order, from `BloubBot.vue` (back to front):

1. back halves of `arcs` (behind the ball)
2. `dots` if `dotsBehind`
3. body: a `paper`-coloured copy of `bodyPath` (so holes don't show the back rings), then the
   ink colour masked by the body with the eyes punched out
4. `dots` if not behind
5. `notif` circle
6. front halves of `arcs`

`studio/hello.ts` → `stillSvg()` is a copy-pasteable implementation for body + eyes. For a PNG,
render the SVG with any rasteriser (`@resvg/resvg-js`, `rsvg-convert`, a headless browser) or use
the app's export bar.

---

## 5. Animated SVG that plays in an `<img>` (GitHub README, Notion, anywhere)

`<img>` SVGs run **no JavaScript**. They do run **SMIL** (`<animate>`, `<animateTransform>`,
`<set>`) and **CSS animations**. So: compute everything offline, bake it.

### The recipe

1. Build a cue list (state / expression / look changes with dates).
2. Loop `i = 0..N`, `t = i / FPS`; apply cues whose date ≤ t (in order, with their own date),
   then `frame = eng.sample(t)`.
3. Collect per-frame strings: `frame.bodyPath`, and each eye as a **polygon in final
   coordinates** (SMIL cannot animate `transform="matrix(...)"`; `hello.ts → eyePolygon()`
   applies the matrix to the capsule's points). Same point count every frame = morphable.
4. Emit `<animate attributeName="d" values="f0;f1;…" dur="…" repeatCount="indefinite"/>`.

### Make it small (GitHub happily serves 100–300 KB, avoid MBs)

- **15–18 FPS** is enough; the engine's motion is eased, viewers won't see the difference.
- **Write each animated path once.** Put it in `<defs>` without `fill`, reuse it with
  `<use href="#body" fill="…"/>` (hello.ts went from 913 KB to 307 KB with this + 15 FPS).
- **Collapse holds:** when consecutive frames are identical, keep only the first and last of
  the run and give `<animate>` explicit `keyTimes` (see `anim()` in `studio/bloub-cards.ts`).
- **Animate transforms instead of paths** when the shape doesn't change: squash/stretch,
  hops, tilts → `<animateTransform type="translate|rotate|scale">` on nested `<g>`s. Only the
  eyes really need per-frame paths.
- Round to 1 decimal (0.1 unit on a 100-radius ball is invisible). Use relative path
  commands (`l dx dy`) for repeated small shapes.

### Seamless loops

- Make every motion periodic over the loop: `sin(2π·k·t/D)` with integer `k`, envelopes that
  return to 0 before `D`.
- The engine's idle drift and blink schedule are **not** periodic over your loop. Blend the
  last ~0.5 s of eye points toward frame 0 (`sampleEyes(…, seamBlend)` in
  `studio/bloub-cards.ts`), or set `wander: 0` in your looks.
- One-shot intro + endless loop: run the intro animations with `fill="freeze"` and start the
  loop ones with `begin="<intro length>s" repeatCount="indefinite"` (the sleeping card does
  this: walks to bed once, then breathes forever).

### Colour that cycles (and stays in sync with other cards)

`studio/palettes.json` + CSS keyframes: `.dyn-fill { animation: dyn_fill 150s linear infinite }`
with one keyframe stop per palette (`paletteCSS()` in `studio/bloub-cards.ts`). All cards built
this way start at load and stay in lockstep. Put `class="dyn-fill"` on anything that should
follow the palette (body, captions, notes, Zzz). Also give it a plain `fill` fallback.

### Captions that follow the story

Stack one `<g opacity="0">` per phrase, each with an `<animate attributeName="opacity">`
and a small `translate` rise, keyed to its beat (`captions()` in `studio/bloub-cards.ts`).
Moving the whole caption block out of the mascot's way is just one more `animateTransform`.

---

## 6. Going further: scenes, props, 3D

All in `studio/bloub-cards.ts` (well commented). Techniques you can lift:

| Need | How it's done there |
|---|---|
| A laptop, a bed, any solid prop | **Orthographic 3D**: `proj([x,y,z])` with a yaw/pitch camera; a `Box` = centre + 3 half-axes; draw only faces whose normal faces the camera (`dot(n, VIEW) > 0`); colour each face with Lambert shading (`litColor`). Real geometry, so it can open, close, slide. |
| A lid that swings shut | Re-project the box every frame and animate each face's `d` + `fill` + `opacity` (faces appear/disappear as they turn) |
| A logo painted on a 3D face | Project the face's two edge vectors → an affine `matrix(a,b,c,d,e,f)`; or re-project the logo points per frame |
| The bot lying in bed (sprite in 3D) | Map the flat sprite onto a plane in the world (`lieM`), interpolate from the upright matrix, decompose into translate·rotate·skewX·scale (`matrixAnim`) because SMIL can't animate `matrix()`. Give it **thickness**: stacked darker copies offset "down" in screen space (`extrusion`). Dent the mattress, squish the pillow. |
| A soft quilt over a body | A height field `h(x, z)` with a gaussian hump, drawn as 4 strips back→front, unrolled by animating its start edge |
| Volume on the flat body | Clip to the body path and layer: radial highlight/shadow gradient, soft dark creases from the outline's notches, a rim-light stroke, a screen-light glow |
| Props that pop (?, !, ♪, ❤, ✦, 💧, 💡) | `floater()`/`pop()`: a text glyph with opacity + translate keyed to a beat |
| AirPods / accessories on the head | Drawn in the body's local frame inside the same transform stack, so they squash, tilt and hop with it |
| A fully posable 3D character | `studio/sphere-cards.ts`: the cloud as ~8 shaded spheres (a sphere is a circle from any angle) + face features projected on the head sphere + per-frame depth sort, split into runs that share a draw order (switched with `visibility`) |

---

## 7. GitHub README checklist (each of these bit us once)

- **One malformed tag and the `<img>` shows nothing.** Browsers forgive inline SVG, `<img>`
  does not. Validate every output: `python -c "import xml.dom.minidom as m; m.parse('x.svg')"`.
  Escape `&` (`&amp;`), `<`, `>` inside text (`&lt;/&gt;` for a `</>` glyph).
- **Never nest `<svg>` inside your SVG for clipping.** Chrome treats it as a separate SMIL
  timeline and freezes everything inside. Use `<clipPath>` on a `<g>`.
- No `<script>`, no external fonts or images (camo blocks them). Use system font stacks.
- GitHub serves images through **camo**, which caches. Set `Cache-Control: max-age=0` on
  dynamic endpoints; expect a few minutes of staleness after a deploy.
- Light/dark: ship two files and use
  `<picture><source media="(prefers-color-scheme: dark)" srcset="…dark"><img src="…light"></picture>`.
- Don't put line breaks inside `<a><picture>…</picture></a>`: GitHub renders the whitespace as
  an underlined space (a stray "-").
- Responsive side-by-side cards: give each `<img>` a **fixed pixel width** that fits two per
  row on desktop (the profile README is ~831–846 px wide, so `width="410"`). They wrap and
  scale to full width on mobile. A percentage width shrinks them to nothing on phones.
- Same card size everywhere (the studio cards are all 360×130 viewBox) keeps rows aligned.
- If a server injects CSS into your SVG (e.g. lag compensation for colour sync), make sure it
  handles a plain `<style>` as well as a `<![CDATA[ ]]>` one.

---

## 8. Character design lessons (cute, not creepy)

Learned the hard way on this mascot; follow them unless you want the opposite:

- **No mirrored eye tilts** for happy/sad/proud moments (`triste`, `colere`, `hilare`,
  `fier`, `confus`, `excite` all tilt): on a round blob they read as angry or scheming. Use
  round, upright eyes (`attentif`, `surpris` at rest) and change *gaze* and *mouth* instead.
- **Keep features close together.** Eyes high + a mouth far below = sinister. When the face
  looks up, the eyes ride to the top of the head; look straight (`pitch ≈ 0`) for happy beats.
- Happy closed eyes: draw round `∩` arcs on **one shared baseline** (both eyes level), not the
  engine's slanted slits. Sleepy eyes: `‿` arcs.
- Mouths: a wide rounded "D" (bowl bottom, blunt corners), never a pointed "V".
- Avoid in-plane 360° spins on a flat character: it reads as orbiting, not twirling. Jump,
  stretch, wiggle and squash on landing instead.
- Accessories as they really look *when worn*: AirPods seen from the front are mostly hidden in
  the ear — a short white stem and a sliver of bud, no mesh, no tip details.
- Lying in bed must be 3D too: almost flat on the mattress, with thickness, sinking in, pillow
  squished, blanket over the body — or it looks like a cardboard cut-out.
- Blush is cute in moderation; drop it if the palette makes faces look sick.
- Every beat needs one readable idea (listening, sad, idea!, singing, encore, nap) with a prop
  that states it, and a caption that says it in a few funny words. No em dashes in captions.

---

## 9. Rules for editing `src/bot/` (from upstream's CLAUDE.md, summarised)

- **The numbers are measurements, not settings.** Gaze angles, eye sizes, radii, timings came
  from frame-by-frame analysis of the reference video. Don't round or "tidy" them.
- `src/bot/` has no framework and no clock: no `Date.now()`, no Vue imports, and `sample()` must
  not mutate state (there's a test).
- All silhouettes share 64 angular samples; new shapes go through a radial profile.
- Transitions are exponential ease-outs; the body never overshoots.
- Code style there: 2 spaces, single quotes, no semicolons, comments in French. `vue-tsc` is
  the only gate: `pnpm build` and `pnpm test` before calling anything done.
- Put new generators in `studio/`, not in `src/bot/`. Read `docs/architecture.md` before
  changing the engine itself.

---

## 10. How to verify your output (do all four)

1. **Well-formed XML** (section 7).
2. **Frozen frames**: inline the SVG in an HTML page several times and freeze each copy at a
   different time with `svg.pauseAnimations(); svg.setCurrentTime(t)`. Screenshot the sheet.
   This shows every beat at once.
3. **Live `<img>` playback**: put the file in `<img>` on a dark and a white background, wait,
   screenshot twice a few seconds apart. Proves SMIL + CSS actually run as an image.
4. **Zoom in** on faces and props at 3–4×. Small details (an evil-looking eye, a flat bud)
   only show up there.

Then look at it at real size, because that is what people will see.

---

## 11. Where things are used live

- Coding + sleeping cards: served by
  [blackscythe123/claude-readme-mascot](https://github.com/blackscythe123/claude-readme-mascot)
  (`/mascot.svg`, default style; `style=crab` gives the old crab).
- Spotify-offline card (AirPods): served by
  [blackscythe123/readme-typing-svg](https://github.com/blackscythe123/readme-typing-svg)
  (`/api/spotify`, `src/templates/offline-mascot-*.svg`).
- To update them: change `studio/bloub-cards.ts`, run it, copy `output/coding-*` and
  `output/sleeping-*` to the mascot repo's `assets/bloub/` (then `node scripts/build-bloub.mjs`
  there), and `output/spotify-offline-*` to the typing repo's templates.
