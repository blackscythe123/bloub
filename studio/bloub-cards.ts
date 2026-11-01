/**
 * Bloub cards: coding, sleeping and spotify-offline, dark + light, 360 x 130.
 * Read AGENTS.md first: it explains every technique used here.
 *
 *   npx tsx studio/bloub-cards.ts                    # -> output/*.svg
 *   OUT=some/dir PALETTES=my-palettes.json npx tsx studio/bloub-cards.ts
 *
 * Live copies: the coding/sleeping cards are served by github.com/blackscythe123/claude-readme-mascot
 * (assets/bloub, bundled by its scripts/build-bloub.mjs); the spotify-offline card by
 * github.com/blackscythe123/readme-typing-svg (src/templates/offline-mascot-*.svg).
 *
 * The face is the real engine: `engine.sample(t)` is a pure function of time, so expressions
 * and gaze targets are cued like a timeline, sampled at FPS and baked into SMIL path morphs.
 * Everything around it (laptop, bed, quilt) is a small orthographic 3D scene: boxes projected
 * through a yaw/pitch camera, back-face culled and Lambert-lit.
 *
 * Colour follows the profile README's 150 s palette lockstep (palettes.json).
 * The spotify-offline card is served by readme-typing-svg, not by this service.
 */
import fs from 'node:fs'
import path from 'node:path'
import { BotEngine, type BotFrame, type Look } from '../src/bot/engine'
import { SHAPE_BY_ID } from '../src/bot/skins'
import { EXPRESSION_BY_ID, type BotExpression } from '../src/bot/expressions'
import { unionOfCirclesProfile } from '../src/bot/shape'

const OUT = process.env.OUT ?? 'output'
const PALETTES: Array<Record<string, string>> = JSON.parse(
  fs.readFileSync(process.env.PALETTES ?? 'studio/palettes.json', 'utf8')
)
const FPS = 18
const W = 360
const H = 130

// ---------------------------------------------------------------- utils
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => {
  const x = clamp(t)
  return x * x * (3 - 2 * x)
}
const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3
const easeIn = (t: number) => clamp(t) ** 2
/** 0 -> 1 -> 0 bump over [a, b] */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI))
/** envelope: rises over [a, a+r], holds, falls over [b-r, b] */
const env = (t: number, a: number, b: number, r = 0.25) => smooth((t - a) / r) * (1 - smooth((t - (b - r)) / r))
const n1 = (v: number) => {
  const r = Math.round(v * 10) / 10
  return (Object.is(r, -0) ? 0 : r).toString()
}
const n2 = (v: number) => {
  const r = Math.round(v * 100) / 100
  return (Object.is(r, -0) ? 0 : r).toString()
}
const deg = (d: number) => (d * Math.PI) / 180

function mix(hexA: string, hexB: string, t: number) {
  const a = parseInt(hexA.slice(1), 16)
  const b = parseInt(hexB.slice(1), 16)
  const ch = (s: number) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, clamp(t)))
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

// ---------------------------------------------------------------- themes
interface Theme {
  mode: 'dark' | 'light'
  ink: string
  spec: string | null
  metal: string
  metalEdge: string
  shadow: number
  muted: string
  glow: string
  bodyLight: number
}
const THEMES: Theme[] = [
  {
    mode: 'dark',
    ink: '#15121b',
    spec: '#ffffff',
    metal: '#686377',
    metalEdge: '#8c87a0',
    shadow: 0.42,
    muted: '#9a95a8',
    glow: '#d9ecff',
    bodyLight: 0.42
  },
  {
    mode: 'light',
    ink: '#fbf8ff',
    spec: null,
    metal: '#cfcbd8',
    metalEdge: '#a29db1',
    shadow: 0.2,
    muted: '#6b6578',
    glow: '#ffffff',
    bodyLight: 0.3
  }
]
const palCol = (th: Theme, i = 0) => '#' + PALETTES[i]![th.mode === 'light' ? 'light_text' : 'dark_text']

function paletteCSS(th: Theme) {
  const n = PALETTES.length
  const p = 100 / n
  const hold = p * 0.82
  let fill = ''
  let stroke = ''
  PALETTES.forEach((_, i) => {
    const c = palCol(th, i)
    fill += `${(i * p).toFixed(2)}%,${(i * p + hold).toFixed(2)}%{fill:${c}}`
    stroke += `${(i * p).toFixed(2)}%,${(i * p + hold).toFixed(2)}%{stroke:${c}}`
  })
  fill += `100%{fill:${palCol(th, 0)}}`
  stroke += `100%{stroke:${palCol(th, 0)}}`
  return (
    `@keyframes dyn_fill{${fill}}@keyframes dyn_stroke{${stroke}}` +
    `.dyn-fill{animation:dyn_fill 150s linear infinite}` +
    `.dyn-stroke{animation:dyn_stroke 150s linear infinite}`
  )
}

// ---------------------------------------------------------------- 3D
type V3 = [number, number, number]
const CAM_YAW = deg(-34)
const CAM_PITCH = deg(21)
const ORIGIN = { x: 70, y: 108 } // where world (0,0,0) lands in the card
const ca = Math.cos(CAM_YAW)
const sa = Math.sin(CAM_YAW)
const cp = Math.cos(CAM_PITCH)
const sp = Math.sin(CAM_PITCH)
const VIEW: V3 = [-sa * cp, sp, ca * cp] // world direction towards the camera
const LIGHT: V3 = norm([-0.55, 0.9, 0.5])

function norm(v: V3): V3 {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function proj([x, y, z]: V3) {
  const X = x * ca + z * sa
  const Z = -x * sa + z * ca
  return { x: ORIGIN.x + X, y: ORIGIN.y - y * cp + Z * sp }
}
const poly = (pts: V3[]) =>
  'M' + pts.map((p) => proj(p)).map((p) => `${n1(p.x)} ${n1(p.y)}`).join('L') + 'Z'

function litColor(base: string, n: V3) {
  const lam = Math.max(0, dot(n, LIGHT))
  const k = 0.5 + 0.72 * lam
  return k >= 1 ? mix(base, '#ffffff', (k - 1) * 0.9) : mix(base, '#000000', (1 - k) * 0.85)
}

interface Box {
  c: V3
  u: V3
  v: V3
  w: V3
}
/** Visible faces of a box, back-face culled, Lambert shaded. */
function boxFaces(b: Box, base: string, edge: string) {
  const faces: string[] = []
  const axes: Array<[V3, V3, V3]> = [
    [b.u, b.v, b.w],
    [b.v, b.w, b.u],
    [b.w, b.u, b.v]
  ]
  for (const [a, e1, e2] of axes) {
    for (const s of [1, -1]) {
      const n = norm(scl(a, s))
      if (dot(n, VIEW) <= 0.001) continue
      const fc = add(b.c, scl(a, s))
      const pts: V3[] = [
        add(add(fc, e1), e2),
        add(add(fc, e1), scl(e2, -1)),
        add(add(fc, scl(e1, -1)), scl(e2, -1)),
        add(add(fc, scl(e1, -1)), e2)
      ]
      faces.push(
        `<path d="${poly(pts)}" fill="${litColor(base, n)}" stroke="${edge}" stroke-width=".6" stroke-linejoin="round"/>`
      )
    }
  }
  return faces.join('')
}

// laptop geometry, px
const LW = 78
const LD = 50
const LT = 3.6
const LL = 44
const LTH = 2.4
const LID_ANGLE = deg(70) // lid direction from the deck, leaning away from the user (towards us)
const HINGE: V3 = [0, LT, LD / 2]
const LID_DIR: V3 = [0, Math.sin(LID_ANGLE), Math.cos(LID_ANGLE)]
const LID_BACK: V3 = [0, -Math.cos(LID_ANGLE), Math.sin(LID_ANGLE)] // normal of the side we see

const deck: Box = { c: [0, LT / 2, 0], u: [LW / 2, 0, 0], v: [0, LT / 2, 0], w: [0, 0, LD / 2] }
const lid: Box = {
  c: add(add(HINGE, scl(LID_DIR, LL / 2)), scl(LID_BACK, LTH / 2)),
  u: [LW / 2 - 0.5, 0, 0],
  v: scl(LID_DIR, LL / 2),
  w: scl(LID_BACK, LTH / 2)
}
const lidBackCenter = add(lid.c, lid.w)
const lidCorners = (inflate = 0): V3[] => {
  const u: V3 = [LW / 2 + inflate, 0, 0]
  const top = add(HINGE, scl(LID_DIR, LL + inflate))
  const bot = add(HINGE, scl(LID_DIR, -inflate * 0.2))
  return [add(top, u), add(top, scl(u, -1)), add(bot, scl(u, -1)), add(bot, u)]
}
/** 2D affine mapping of the lid's back plane: logo-local x -> world +x, local y -> down the lid. */
function lidMatrix(scale: number, along = LL / 2) {
  const o = proj(add(add(HINGE, scl(LID_DIR, along)), scl(LID_BACK, LTH)))
  const ux = proj(add(add(add(HINGE, scl(LID_DIR, along)), scl(LID_BACK, LTH)), [1, 0, 0]))
  const vy = proj(add(add(HINGE, scl(LID_DIR, along - 1)), scl(LID_BACK, LTH)))
  return `matrix(${n2((ux.x - o.x) * scale)},${n2((ux.y - o.y) * scale)},${n2((vy.x - o.x) * scale)},${n2(
    (vy.y - o.y) * scale
  )},${n1(o.x)},${n1(o.y)})`
}

// ---------------------------------------------------------------- engine rig
const CLOUD_CIRCLES = [
  { x: -0.44, y: 0.2, r: 0.54 },
  { x: 0.46, y: 0.2, r: 0.5 },
  { x: 0.02, y: 0.3, r: 0.6 },
  { x: -0.24, y: -0.3, r: 0.48 },
  { x: 0.3, y: -0.24, r: 0.44 }
]
const CLOUD_K = 1.02 / Math.max(...unionOfCirclesProfile(CLOUD_CIRCLES))
const NUAGE = SHAPE_BY_ID.get('nuage')!.radii
const expr = (id: string) => EXPRESSION_BY_ID.get(id)!
/** eyes shut: the engine's own lid squash (`open`) driven to zero */
const SHUT: BotExpression = {
  ...expr('somnolent'),
  id: 'somnolent',
  gaze: { yaw: 4, pitch: -16, roll: -4 },
  eyes: [
    { w: 0.24, h: 0.42, tilt: 0, open: 0 },
    { w: 0.24, h: 0.42, tilt: 0, open: 0 }
  ]
}
const look = (yaw: number, pitch: number, wander = 0.4): Look => ({ yaw, pitch, mix: 1, spin: 0, wander })
const AT_SCREEN = look(-20, -12, 0.35)
const AT_VIEWER = look(-4, 2, 0.25)

interface Cue {
  t: number
  expr?: BotExpression
  look?: Look | null
  lookMorph?: number
}

interface EyeShot {
  d: [string, string]
  spec: Array<{ x: number; y: number; r: number }>
  centers: Array<{ x: number; y: number }>
  pts: number[][]
}

function eyeShot(f: BotFrame): EyeShot {
  const pts: number[][] = []
  const spec: EyeShot['spec'] = []
  const centers: EyeShot['centers'] = []
  for (const e of f.eyes) {
    const n = e.d.match(/-?\d+\.?\d*/g)!.map(Number)
    const hw = -n[0]!
    const r = n[2]!
    const hh = r - n[1]!
    const m = e.matrix.match(/-?\d+\.?\d*/g)!.map(Number)
    const [a, b, c, d, ex, ey] = m as [number, number, number, number, number, number]
    const loc: Array<[number, number]> = []
    const corners: Array<[number, number, number]> = [
      [hw - r, hh - r, 0],
      [-(hw - r), hh - r, 90],
      [-(hw - r), -(hh - r), 180],
      [hw - r, -(hh - r), 270]
    ]
    for (const [cx, cy, a0] of corners)
      for (let k = 0; k < 4; k++) {
        const ang = deg(a0 + (k / 3) * 90)
        loc.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r])
      }
    const flat: number[] = []
    for (const [x, y] of loc) flat.push(a * x + c * y + ex, b * x + d * y + ey)
    pts.push(flat)
    const ys = flat.filter((_, i) => i % 2)
    const h = Math.max(...ys) - Math.min(...ys)
    centers.push({ x: ex, y: ey })
    spec.push({ x: ex - hw * 0.28 + c * -hh * 0.35, y: ey + d * -hh * 0.42, r: 4.2 * clamp((h - 10) / 22) })
  }
  return { pts, spec, centers, d: ['', ''] }
}
const polyD = (flat: number[]) => {
  let s = ''
  for (let i = 0; i < flat.length; i += 2) s += (i ? 'L' : 'M') + n1(flat[i]!) + ' ' + n1(flat[i + 1]!)
  return s + 'Z'
}

/** Run the engine over [0, dur] at FPS, applying cues at their own dates. */
function sampleEyes(cues: Cue[], dur: number, seamBlend = 0): EyeShot[] {
  const eng = new BotEngine(100, 'idle', NUAGE, expr('neutre'))
  const queue = [...cues].sort((a, b) => a.t - b.t)
  const shots: EyeShot[] = []
  const N = Math.round(dur * FPS)
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dur
    while (queue.length && queue[0]!.t <= t) {
      const c = queue.shift()!
      if (c.expr) eng.setExpression(c.expr, c.t)
      if (c.look !== undefined) eng.setLook(c.look, c.t, c.lookMorph ?? 0.35)
    }
    shots.push(eyeShot(eng.sample(t)))
  }
  if (seamBlend > 0) {
    const first = shots[0]!
    shots.forEach((s, i) => {
      const t = (i / N) * dur
      const w = smooth((t - (dur - seamBlend)) / seamBlend)
      if (w <= 0) return
      s.pts = s.pts.map((p, e) => p.map((v, k) => lerp(v, first.pts[e]![k]!, w)))
      s.spec = s.spec.map((sp, e) => ({
        x: lerp(sp.x, first.spec[e]!.x, w),
        y: lerp(sp.y, first.spec[e]!.y, w),
        r: lerp(sp.r, first.spec[e]!.r, w)
      }))
    })
  }
  for (const s of shots) s.d = [polyD(s.pts[0]!), polyD(s.pts[1]!)]
  return shots
}

const BODY = new BotEngine(100, 'idle', NUAGE, expr('neutre')).sample(0).bodyPath
const bodyNums = BODY.match(/-?\d+\.?\d*/g)!.map(Number)
const BODY_BOTTOM = Math.max(...bodyNums.filter((_, i) => i % 2))
const NOTCHES = NUAGE.flatMap((r, i, a) => {
  const prev = a[(i - 1 + a.length) % a.length]!
  const next = a[(i + 1) % a.length]!
  const ang = (i / a.length) * Math.PI * 2
  // only the upper notches: the lower ones sit on the floor, out of the light
  return r < prev && r <= next && Math.sin(ang) < 0.2 ? [ang] : []
})
const BODY_TOP = -Math.min(...bodyNums.filter((_, i) => i % 2))
const BODY_RIGHT = Math.max(...bodyNums.filter((_, i) => i % 2 === 0))

// ---------------------------------------------------------------- SMIL helpers
interface AnimOpts {
  dur: number
  begin?: number
  loop?: boolean
  freeze?: boolean
}
/** Animate `attr` through per-frame `values`, collapsing runs of identical frames. */
function anim(tag: 'animate' | 'animateTransform', attr: string, values: string[], o: AnimOpts, type?: string) {
  const N = values.length - 1
  const keep: number[] = []
  for (let i = 0; i <= N; i++) {
    if (i === 0 || i === N || values[i] !== values[i - 1] || values[i] !== values[i + 1]) keep.push(i)
  }
  if (keep.every((i) => values[i] === values[0])) return ''
  const v = keep.map((i) => values[i]).join(';')
  const kt = keep.map((i) => n2(i / N).replace(/^0\./, '0.')).join(';')
  const rep = o.loop ? ' repeatCount="indefinite"' : ''
  const fill = o.freeze ? ' fill="freeze"' : ''
  const typeAttr = type ? ` type="${type}"` : ''
  return `<${tag} attributeName="${attr}"${typeAttr} dur="${o.dur}s" begin="${o.begin ?? 0}s"${rep}${fill} calcMode="linear" keyTimes="${kt.replace(/^0;/, '0;')}" values="${v}"/>`
}
const times = (dur: number) => Array.from({ length: Math.round(dur * FPS) + 1 }, (_, i) => (i / Math.round(dur * FPS)) * dur)

// ---------------------------------------------------------------- shared drawing
function defs(th: Theme, extra = '') {
  const vol =
    th.mode === 'dark'
      ? `<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/>`
      : `<stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/>`
  return `<defs>
<radialGradient id="vol" cx=".34" cy=".26" r=".86" fx=".3" fy=".2">${vol}</radialGradient>
<radialGradient id="screenLight" cx=".2" cy=".95" r=".75"><stop offset="0" stop-color="${th.glow}" stop-opacity="${th.bodyLight}"/><stop offset="1" stop-color="${th.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="lidGloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
<clipPath id="bodyClip"><path d="${BODY}"/></clipPath>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="crease" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="glowFx" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${extra}</defs>`
}

/** The puffy body: palette fill + volume, lobe creases, rim light, screen light. */
function bodyLayers(th: Theme, screenLit: string) {
  // soft folds running inwards from each notch of the outline (local minima of the profile)
  const creases = NOTCHES.map(
    (a) =>
      `<path d="M${n1(Math.cos(a) * 104)} ${n1(Math.sin(a) * 104)}L${n1(Math.cos(a) * 70)} ${n1(Math.sin(a) * 70)}" stroke="#000" stroke-opacity="${th.mode === 'dark' ? 0.22 : 0.3}" stroke-width="7" stroke-linecap="round" filter="url(#crease)"/>`
  ).join('')
  return `<path d="${BODY}" fill="${palCol(th)}" class="dyn-fill"/>
<g clip-path="url(#bodyClip)">
<rect x="-120" y="-120" width="240" height="240" fill="url(#vol)"/>
${creases}
<rect x="-120" y="-120" width="240" height="240" fill="url(#screenLight)"${screenLit}/>
<ellipse cx="-38" cy="-62" rx="20" ry="11" fill="#fff" opacity="${th.mode === 'dark' ? 0.5 : 0.32}" transform="rotate(-24 -38 -62)" filter="url(#soft)"/>
</g>
<path d="${BODY}" fill="none" stroke="url(#rim)" stroke-width="3"/>`
}

function eyesMarkup(th: Theme, shots: EyeShot[], o: AnimOpts, attrs = '') {
  let s = `<g${attrs}>`
  for (let e = 0; e < 2; e++) {
    s += `<path d="${shots[0]!.d[e]}" fill="${th.ink}">${anim('animate', 'd', shots.map((x) => x.d[e]!), o)}</path>`
  }
  if (th.spec) {
    for (let e = 0; e < 2; e++) {
      const sp = shots.map((x) => x.spec[e]!)
      s += `<circle cx="${n1(sp[0]!.x)}" cy="${n1(sp[0]!.y)}" r="${n1(sp[0]!.r)}" fill="${th.spec}" opacity=".9">${anim('animate', 'cx', sp.map((p) => n1(p.x)), o)}${anim('animate', 'cy', sp.map((p) => n1(p.y)), o)}${anim('animate', 'r', sp.map((p) => n1(p.r)), o)}</circle>`
    }
  }
  return s + '</g>'
}

function laptopMarkup(th: Theme, glowAnim: string, logoAnim: string, haloOpacity: string) {
  const halo = `<path d="${poly(lidCorners(3))}" class="dyn-fill" fill="${palCol(th)}" filter="url(#softer)" opacity="${haloOpacity}">${glowAnim}</path>`
  const lidFaces = boxFaces(lid, th.metal, th.metalEdge)
  const gloss = `<path d="${poly(lidCorners(-0.6).map((p) => add(p, scl(LID_BACK, LTH + 0.05))))}" fill="url(#lidGloss)"/>`
  const logoPath = new BotEngine(100, 'idle', NUAGE, null).sample(0).bodyPath
  const logo = `<g transform="${lidMatrix(0.085, LL * 0.52)}"><path d="${logoPath}" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)">${logoAnim}</path></g>`
  // top edge highlight (catches the key light)
  const tl = lidCorners(0)
  const edge = `<path d="M${n1(proj(add(tl[1]!, scl(LID_BACK, LTH))).x)} ${n1(proj(add(tl[1]!, scl(LID_BACK, LTH))).y)}L${n1(proj(add(tl[0]!, scl(LID_BACK, LTH))).x)} ${n1(proj(add(tl[0]!, scl(LID_BACK, LTH))).y)}" stroke="#fff" stroke-opacity=".45" stroke-width=".8" stroke-linecap="round"/>`
  return { halo, deck: boxFaces(deck, th.metal, th.metalEdge), lid: lidFaces + gloss + logo + edge }
}

function groundShadow(th: Theme, mascotX: number, mascotY: number, shadowAnim = '') {
  const c: V3[] = [
    [LW / 2 + 4, 0, LD / 2 + 6],
    [-LW / 2 - 4, 0, LD / 2 + 6],
    [-LW / 2 - 4, 0, -LD / 2 - 4],
    [LW / 2 + 4, 0, -LD / 2 - 4]
  ]
  return `<path d="${poly(c)}" fill="#000" opacity="${th.shadow * 0.8}" filter="url(#softer)"/>
<ellipse cx="${n1(mascotX)}" cy="${n1(mascotY)}" rx="30" ry="7" fill="#000" opacity="${th.shadow}" filter="url(#soft)">${shadowAnim}</ellipse>`
}

function cardText(th: Theme, title: string, status: string, statusDot: string) {
  return `<g font-family="'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif">
<text x="178" y="44" font-size="10.5" font-weight="600" letter-spacing="2.2" fill="${th.muted}">BLACKSCYTHE123</text>
<text x="177" y="72" font-size="23" font-weight="700" fill="${palCol(th)}" class="dyn-fill">${title}</text>
${statusDot}
<text x="192" y="95" font-size="12" fill="${th.muted}">${status}</text>
</g>`
}

interface Phrase {
  a: number
  b: number
  title?: string
  status?: string
  dot?: string
}
const FONT = `font-family="'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif"`
// Pastille "live" : #3fb950 sur fond sombre ; en clair il ne fait que 2.54:1 sur blanc,
// donc le vert succès de GitHub (#1a7f37, 5.1:1) pour passer le seuil WCAG 1.4.11 (3:1).
const liveGreen = (th: Theme) => (th.mode === 'light' ? '#1a7f37' : '#3fb950')
const liveDot = (th: Theme) => `<circle cx="183" cy="91" r="3.6" fill="${liveGreen(th)}"><animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values="1;.35;1"/></circle>`
const idleDot = (th: Theme) => `<circle cx="183" cy="91" r="3.6" fill="none" stroke="${th.muted}" stroke-width="1.6"/>`

/**
 * Captions synced to the choreography: each phrase fades/rises in over its own beat.
 * `hold` = the last phrase stays on screen (one-shot timelines).
 */
function captions(th: Theme, items: Phrase[], dur: number, opt: { begin?: number; loop?: boolean; hold?: boolean } = {}) {
  const f = 0.22
  const k = (t: number) => n2(clamp(t / dur))
  return items
    .map((p, i) => {
      const last = opt.hold && i === items.length - 1
      const pts: Array<[number, number]> = [[0, 0]]
      if (p.a > 0) pts.push([p.a, 0])
      pts.push([p.a + f, 1])
      if (last) pts.push([dur, 1])
      else {
        pts.push([p.b - f, 1], [p.b, 0])
        if (p.b < dur) pts.push([dur, 0])
      }
      const kt = pts.map(([t]) => k(t)).join(';')
      const vals = pts.map(([, v]) => v).join(';')
      const rise = pts.map(([, v]) => `0 ${v ? 0 : 4}`).join(';')
      const timing = `dur="${dur}s" begin="${opt.begin ?? 0}s"${opt.loop ? ' repeatCount="indefinite"' : ' fill="freeze"'} keyTimes="${kt}"`
      const title = p.title
        ? `<text x="177" y="72" font-size="23" font-weight="700" fill="${palCol(th)}" class="dyn-fill">${p.title}</text>`
        : ''
      const status = p.status ? `${p.dot ?? ''}<text x="192" y="95" font-size="12" fill="${th.muted}">${p.status}</text>` : ''
      return `<g opacity="0"><animate attributeName="opacity" ${timing} values="${vals}"/><animateTransform attributeName="transform" type="translate" ${timing} values="${rise}"/>${title}${status}</g>`
    })
    .join('')
}
const label = (th: Theme) =>
  `<text x="178" y="44" ${FONT} font-size="10.5" font-weight="600" letter-spacing="2.2" fill="${th.muted}">BLACKSCYTHE123</text>`

function wrap(th: Theme, title: string, body: string, extraDefs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${paletteCSS(th)}</style>
${defs(th, extraDefs)}
${body}
</svg>
`
}

// mascot placement (world: just behind the deck's far edge, to the right of centre)
const MS = 0.37
const MASCOT_WORLD: V3 = [28, 0, -LD / 2 - 4]
const mFoot = proj(MASCOT_WORLD)
const M_BASE = { x: mFoot.x, y: mFoot.y - BODY_BOTTOM * MS }

// ================================================================= CODING
/**
 * The coding card, 12 s seamless loop:
 *   in the zone (tongue out, typing) -> hmm (pout, looks up, "?") -> EUREKA (star eyes,
 *   sparkles, frantic typing) -> it compiled!! (big jump + bounce, happy arcs, grin, confetti,
 *   tick) -> nailed it (wink, wiggle) -> shipping it (typing with a grin, head bobs).
 * Every face stays round and upright: no mirrored eye tilts (they read as evil).
 */
function codingCard(th: Theme) {
  const D = 12
  const ts = times(D)
  const o: AnimOpts = { dur: D, loop: true }
  // beats
  const HMM_A = 3.3
  const EUREKA_A = 4.55
  const JUMP_A = 6.55
  const JUMP_B = 7.25
  const BOUNCE_B = 7.62
  const WINK_A = 8.4
  const SHIP_A = 9.2
  const typing = (t: number) =>
    Math.max(env(t, -1, HMM_A + 0.05, 0.3), env(t, EUREKA_A, JUMP_A, 0.15), env(t, SHIP_A, 13, 0.3)) // on over the seam
  const burst = (t: number) => env(t, EUREKA_A, JUMP_A, 0.15)
  const cues: Cue[] = [
    { t: -6, expr: expr('attentif'), look: AT_SCREEN },
    { t: HMM_A, expr: expr('attentif'), look: look(24, 22, 0.6), lookMorph: 0.45 },
    { t: EUREKA_A, expr: expr('attentif'), look: look(-20, -10, 0.2), lookMorph: 0.2 },
    { t: JUMP_A, expr: expr('attentif'), look: AT_VIEWER, lookMorph: 0.3 },
    { t: SHIP_A, expr: expr('attentif'), look: AT_SCREEN, lookMorph: 0.45 }
  ]
  const eyes = sampleEyes(cues, D, 0.6)

  // ---- body choreography (all periodic over D)
  const F = 4.25 // typing bobs per second; F * D is an integer, so the loop is seamless
  const pose = ts.map((t) => {
    const ty = typing(t)
    const fast = burst(t)
    const b = Math.abs(Math.sin(Math.PI * (F + 2.25 * fast) * t))
    let dy = -b * (1.6 + 2.4 * fast) * ty
    let rot = -3.5 * ty + 3 * Math.sin(t * Math.PI * 2 * 2.125) * fast // frantic wobble
    let sx = 1 + (0.012 + 0.03 * fast) * b * ty
    let sy = 1 - (0.022 + 0.05 * fast) * b * ty
    // shipping: head bobs to the rhythm
    const ship = env(t, SHIP_A, 11.7, 0.3)
    rot += 4 * Math.sin(t * Math.PI * 2 * 1.0625) * ship
    // hmm: leans back, tilts
    const think = env(t, HMM_A, EUREKA_A, 0.3)
    rot += 8 * think
    dy -= 2.5 * think
    // eureka jolt
    const jolt = bump(t, EUREKA_A, EUREKA_A + 0.3)
    dy -= 7 * jolt
    sy += 0.08 * jolt
    // it compiled: crouch -> BIG jump -> squash -> happy bounce -> squash
    const ant = bump(t, JUMP_A - 0.2, JUMP_A + 0.05)
    sy -= 0.14 * ant
    sx += 0.1 * ant
    if (t > JUMP_A + 0.05 && t < JUMP_B) {
      const u = (t - JUMP_A - 0.05) / (JUMP_B - JUMP_A - 0.05)
      dy -= 19 * Math.sin(u * Math.PI)
      sy += 0.1 * Math.sin(u * Math.PI)
      sx -= 0.07 * Math.sin(u * Math.PI)
    }
    const land1 = bump(t, JUMP_B, JUMP_B + 0.12)
    sy -= 0.15 * land1
    sx += 0.11 * land1
    if (t > JUMP_B + 0.1 && t < BOUNCE_B) dy -= 7 * Math.sin(((t - JUMP_B - 0.1) / (BOUNCE_B - JUMP_B - 0.1)) * Math.PI)
    const land2 = bump(t, BOUNCE_B, BOUNCE_B + 0.15)
    sy -= 0.08 * land2
    sx += 0.06 * land2
    // nailed it: a happy side-to-side wiggle
    const wig = env(t, WINK_A, SHIP_A, 0.15)
    rot += 7 * Math.sin((t - WINK_A) * Math.PI * 2 * 2.5) * wig
    return { dy, rot, sx, sy }
  })
  const tr = anim('animateTransform', 'transform', pose.map((p) => `0 ${n1(p.dy)}`), o, 'translate')
  const rt = anim('animateTransform', 'transform', pose.map((p) => `${n1(p.rot)} 0 ${n1(BODY_BOTTOM * MS)}`), o, 'rotate')
  const sc = anim('animateTransform', 'transform', pose.map((p) => `${n2(p.sx)} ${n2(p.sy)}`), o, 'scale')
  const hopShadow =
    anim('animate', 'rx', pose.map((p) => n1(30 + p.dy * 0.9)), o) +
    anim('animate', 'opacity', pose.map((p) => n2(th.shadow * clamp(1 + p.dy / 30))), o)

  // ---- screen light flicker: brighter while typing, flash on success
  const glow = ts.map((t) => {
    const base = 0.55 + 0.25 * typing(t)
    const fl = (0.12 + 0.1 * burst(t)) * Math.sin(t * 23.1) * Math.sin(t * 7.7) * typing(t)
    return clamp(base + fl + 0.4 * bump(t, JUMP_A + 0.1, JUMP_A + 1.0))
  })
  const glowAnim = anim('animate', 'opacity', glow.map((g) => n2(g * 0.75)), o)
  const bodyLit = anim('animate', 'opacity', glow.map((g) => n2(g)), o)

  // ---- face extras, body-local units, following the eyes every frame
  const faceAt = (i: number) => {
    const c = eyes[i]!.centers
    return { x: (c[0]!.x + c[1]!.x) / 2 + 2, y: (c[0]!.y + c[1]!.y) / 2 + 26 }
  }
  const mouthParams = (t: number) => {
    // base: concentration, a small "o" with the tongue tip out
    let smile = 0.2
    let open = 0.55
    let w = 5
    const hmm = env(t, HMM_A, EUREKA_A, 0.25)
    smile = lerp(smile, -0.45, hmm)
    open = lerp(open, 0, hmm)
    const eur = env(t, EUREKA_A, JUMP_A, 0.15)
    smile = lerp(smile, 0.7, eur)
    open = lerp(open, 0.6 + 0.25 * Math.abs(Math.sin(t * Math.PI * 4)), eur)
    w = lerp(w, 8, eur)
    const win = env(t, JUMP_A, WINK_A, 0.15)
    smile = lerp(smile, 1, win)
    open = lerp(open, 0.8, win)
    w = lerp(w, 10, win)
    const nail = env(t, WINK_A, SHIP_A, 0.15)
    smile = lerp(smile, 1, nail)
    open = lerp(open, 0.35, nail)
    w = lerp(w, 8, nail)
    const ship = env(t, SHIP_A, 11.6, 0.35)
    smile = lerp(smile, 0.85, ship)
    open = lerp(open, 0.15, ship)
    w = lerp(w, 7.5, ship)
    return { smile, open, w }
  }
  const mouthD = ts.map((t, i) => {
    const { x: mx, y: my } = faceAt(i)
    const { smile, open, w } = mouthParams(t)
    const y0 = my - smile * 3.5
    const top = my + smile * 4.5
    const bot = top + open * 24
    return `M${n1(mx - w)} ${n1(y0)}C${n1(mx - w * 0.45)} ${n1(top)} ${n1(mx + w * 0.45)} ${n1(top)} ${n1(mx + w)} ${n1(y0)}C${n1(mx + w * 0.95)} ${n1(bot)} ${n1(mx - w * 0.95)} ${n1(bot)} ${n1(mx - w)} ${n1(y0)}Z`
  })
  const tongue = ts.map((t, i) => {
    const { open, w } = mouthParams(t)
    const f = faceAt(i)
    // the tongue tip pokes out while concentrating, and shows inside big grins
    const poke = env(t, -1, HMM_A, 0.2) + env(t, 11.6, 13, 0.3)
    return {
      cx: n1(f.x + 2),
      cy: n1(f.y + 7 + open * 9 + 3 * poke),
      rx: n1(Math.max(w * 0.7, 4)),
      ry: n1(Math.max(clamp((open - 0.4) / 0.5) * 7, 4.5 * clamp(poke)))
    }
  })
  const mouth = `<clipPath id="mouthClip"><path d="${mouthD[0]}">${anim('animate', 'd', mouthD, o)}</path></clipPath>
<path d="${mouthD[0]}" fill="${th.mode === 'dark' ? '#3a1427' : th.ink}" stroke="${th.ink}" stroke-width="5" stroke-linejoin="round">${anim('animate', 'd', mouthD, o)}</path>
<g clip-path="url(#mouthClip)"><ellipse cx="${tongue[0]!.cx}" cy="${tongue[0]!.cy}" rx="${tongue[0]!.rx}" ry="${tongue[0]!.ry}" fill="#ff8da1">${anim('animate', 'cx', tongue.map((v) => v.cx), o)}${anim('animate', 'cy', tongue.map((v) => v.cy), o)}${anim('animate', 'rx', tongue.map((v) => v.rx), o)}${anim('animate', 'ry', tongue.map((v) => v.ry), o)}</ellipse></g>`

  // eyes: engine eyes, round "∩" happy arcs and star eyes for the eureka, cross-faded per eye
  const starW = ts.map((t) => env(t, EUREKA_A + 0.05, JUMP_A, 0.12))
  const happyW = [0, 1].map((e) =>
    ts.map((t) => Math.max(env(t, JUMP_A + 0.1, WINK_A + 0.05, 0.12), e === 1 ? env(t, WINK_A - 0.05, SHIP_A, 0.12) : 0))
  )
  const level = (s: (typeof eyes)[number]) => (s.centers[0]!.y + s.centers[1]!.y) / 2
  const arcD = (e: number) =>
    eyes.map((s) => {
      const c = s.centers[e]!
      const y = level(s)
      return `M${n1(c.x - 10)} ${n1(y + 5)}C${n1(c.x - 10)} ${n1(y - 7.5)} ${n1(c.x + 10)} ${n1(y - 7.5)} ${n1(c.x + 10)} ${n1(y + 5)}`
    })
  const starD = (e: number) =>
    eyes.map((s, i) => {
      const c = s.centers[e]!
      const y = level(s)
      const r = 14 * (1 + 0.12 * Math.sin(ts[i]! * Math.PI * 6)) // twinkle
      let d = ''
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 - Math.PI / 2
        const rr = k % 2 ? r * 0.32 : r
        d += (k ? 'L' : 'M') + n1(c.x + Math.cos(a) * rr) + ' ' + n1(y + Math.sin(a) * rr)
      }
      return d + 'Z'
    })
  const layer = (d: string[], w: number[], paint: string) => {
    const op = w.map((v) => n2(v))
    return `<path d="${d[0]}" ${paint} opacity="${op[0]}">${anim('animate', 'd', d, o)}${anim('animate', 'opacity', op, o)}</path>`
  }
  const arcs = [0, 1]
    .map(
      (e) =>
        layer(arcD(e), happyW[e]!, `fill="none" stroke="${th.ink}" stroke-width="6.5" stroke-linecap="round"`) +
        layer(starD(e), starW, `fill="${th.ink}" stroke="${th.ink}" stroke-width="2" stroke-linejoin="round"`)
    )
    .join('')
  const eyesSvg = [0, 1]
    .map((e) => {
      const op = ts.map((_, i) => n2(1 - Math.max(happyW[e]![i]!, starW[i]!)))
      let g = `<g opacity="${op[0]}">${anim('animate', 'opacity', op, o)}<path d="${eyes[0]!.d[e]}" fill="${th.ink}">${anim('animate', 'd', eyes.map((x) => x.d[e]!), o)}</path>`
      if (th.spec) {
        const sp = eyes.map((x) => x.spec[e]!)
        g += `<circle cx="${n1(sp[0]!.x)}" cy="${n1(sp[0]!.y)}" r="${n1(sp[0]!.r)}" fill="${th.spec}" opacity=".9">${anim('animate', 'cx', sp.map((q) => n1(q.x)), o)}${anim('animate', 'cy', sp.map((q) => n1(q.y)), o)}${anim('animate', 'r', sp.map((q) => n1(q.r)), o)}</circle>`
      }
      return g + '</g>'
    })
    .join('')

  // ---- paws on the deck: alternating taps, frantic during the eureka, lifted on the jump
  const paw = (side: number, x: number) => {
    const p = proj([x, LT, -LD / 2 + 9])
    const vals = ts.map((t, i) => {
      const ph = Math.sin(Math.PI * 2 * (F + 2.25 * burst(t)) * 0.5 * t + side * Math.PI)
      const cheer = env(t, JUMP_A, WINK_A, 0.15)
      return `0 ${n1(-Math.max(0, ph) * (2.6 + 1.6 * burst(t)) * typing(t) + pose[i]!.dy * 0.9 * cheer - 8 * cheer)}`
    })
    return `<g transform="translate(${n1(p.x)} ${n1(p.y)})"><g>${anim('animateTransform', 'transform', vals, o, 'translate')}<ellipse rx="6" ry="4.2" fill="${palCol(th)}" class="dyn-fill"/><ellipse rx="6" ry="4.2" fill="url(#vol)"/></g></g>`
  }

  // ---- floating stuff: code glyphs while typing, ?, sparkles, confetti
  const glyphs = ['{ }', '&lt;/&gt;', '=&gt;', ';', '( )', '[ ]', '&amp;&amp;', '#', '++', '//']
  const lidTopL = proj(lidCorners(0)[1]!)
  const lidTopR = proj(lidCorners(0)[0]!)
  let rng = 7
  const rnd = () => ((rng = (rng * 16807) % 2147483647) / 2147483647)
  const kt = (a: number) => n2(clamp(a / D))
  const pop = (x: number, y: number, a: number, b: number, content: string, dx: number, dy: number, size: number, paint: string, mono = false) =>
    `<g transform="translate(${n1(x)} ${n1(y)})"><g opacity="0"><animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(a)};${kt(a + 0.15)};${kt(b - 0.3)};${kt(b)};1" values="0;0;1;.85;0;0"/><animateTransform attributeName="transform" type="translate" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(a)};${kt(b)};1" values="0 0;0 0;${n1(dx)} ${n1(dy)};${n1(dx)} ${n1(dy)}"/><text ${mono ? 'font-family="ui-monospace,Consolas,monospace"' : FONT} font-size="${n1(size)}" font-weight="800" text-anchor="middle" ${paint}>${content}</text></g></g>`
  const pal = `fill="${palCol(th)}" class="dyn-fill"`
  let fx = ''
  let gi = 0
  for (let t = 0.2; t < D - 0.8; t += 0.42 - 0.16 * burst(t)) {
    if (typing(t) < 0.6) continue
    const u = 0.15 + rnd() * 0.75
    fx += pop(lerp(lidTopL.x, lidTopR.x, u), lerp(lidTopL.y, lidTopR.y, u) - 2, t, t + 1.7, glyphs[gi++ % glyphs.length]!, (rnd() - 0.5) * 18, -29, 7 + rnd() * 2.5 + 2 * burst(t), pal, true)
  }
  const head = { x: M_BASE.x, y: M_BASE.y - BODY_BOTTOM * MS * 0.9 }
  fx += pop(head.x + 30, head.y - 2, HMM_A + 0.15, EUREKA_A, '?', 4, -7, 17, pal)
  fx += pop(head.x - 24, head.y + 6, HMM_A + 0.5, EUREKA_A, '?', -3, -5, 11, pal)
  // eureka sparkles burst around the head
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3
    fx += pop(head.x + Math.cos(a) * 18, head.y + 10 + Math.sin(a) * 14, EUREKA_A + k * 0.04, EUREKA_A + 1.1, '&#10022;', Math.cos(a) * 16, Math.sin(a) * 12 - 6, 9 + (k % 2) * 5, pal)
  }
  // confetti on "it compiled"
  const conf = ['&#9632;', '&#9679;', '&#10022;', '&#9650;']
  for (let k = 0; k < 16; k++) {
    const x = head.x + (rnd() - 0.5) * 120
    const white = k % 3 === 0
    fx += pop(x, head.y - 30 - rnd() * 10, JUMP_A + 0.25 + rnd() * 0.25, JUMP_A + 1.9 + rnd() * 0.4, conf[k % 4]!, (rnd() - 0.5) * 30, 55 + rnd() * 35, 5 + rnd() * 4, white ? 'fill="#ffffff"' : pal)
  }
  fx += pop(head.x + 30, head.y + 4, WINK_A + 0.05, SHIP_A, '&#10022;', 4, -5, 13, pal)

  // ---- success badge pops above the lid
  const bx = lerp(lidTopL.x, lidTopR.x, 0.62)
  const by = Math.min(lidTopL.y, lidTopR.y) - 22
  const badge = `<g transform="translate(${n1(bx)} ${n1(by)})"><g opacity="0">
<animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(JUMP_A + 0.2)};${kt(JUMP_A + 0.35)};${kt(WINK_A + 0.3)};${kt(WINK_A + 0.7)};1" values="0;0;1;1;0;0"/>
<animateTransform attributeName="transform" type="scale" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(JUMP_A + 0.2)};${kt(JUMP_A + 0.4)};${kt(JUMP_A + 0.55)};${kt(WINK_A + 0.3)};${kt(WINK_A + 0.7)};1" values="0;0;1.3;1;1;.6;.6"/>
<animateTransform attributeName="transform" type="translate" additive="sum" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(JUMP_A + 0.2)};${kt(WINK_A + 0.7)};1" values="0 4;0 4;0 -6;0 -6"/>
<circle r="8.5" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)"/>
<path d="M-3.8 0.2L-1.2 2.8L4 -2.6" fill="none" stroke="${th.mode === 'dark' ? '#15121b' : '#ffffff'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</g></g>`

  const lap = laptopMarkup(th, glowAnim, '', '.6')
  const mascot = `<g transform="translate(${n1(M_BASE.x)} ${n1(M_BASE.y)})"><g>${tr}<g>${rt}<g transform="translate(0 ${n1(BODY_BOTTOM * MS)})"><g>${sc}<g transform="translate(0 ${n1(-BODY_BOTTOM * MS)}) scale(${MS})">
${bodyLayers(th, '')}
<g clip-path="url(#bodyClip)"><rect x="-120" y="-120" width="240" height="240" fill="url(#screenLight)" opacity="0">${bodyLit}</rect></g>
${eyesSvg}
${arcs}
${mouth}
</g></g></g></g></g></g>`

  const dot = `<circle cx="183" cy="91" r="3.6" fill="${liveGreen(th)}"><animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values="1;.35;1"/></circle><circle cx="183" cy="91" r="3.6" fill="none" stroke="${liveGreen(th)}" stroke-width="1.2"><animate attributeName="r" dur="1.5s" repeatCount="indefinite" values="3.6;8"/><animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values=".7;0"/></circle>`

  const body = `${groundShadow(th, mFoot.x, mFoot.y + 1, hopShadow)}
${mascot}
${lap.deck}
${paw(0, 2)}${paw(1, 17)}
${lap.halo}
${lap.lid}
${fx}
${badge}
${label(th)}<g ${FONT}>${captions(
    th,
    [
      { a: 0, b: HMM_A, title: 'In the zone', status: 'keys go brrrr', dot },
      { a: HMM_A, b: EUREKA_A, title: 'Hmm&#8230;', status: 'asking the rubber duck', dot },
      { a: EUREKA_A, b: JUMP_A + 0.15, title: 'Eureka!', status: 'outrunning the linter', dot },
      { a: JUMP_A + 0.15, b: WINK_A, title: 'It compiled!!', status: 'first try! (no one saw)', dot },
      { a: WINK_A, b: SHIP_A, title: 'Nailed it', status: 'tiny victory dance', dot },
      { a: SHIP_A, b: D, title: 'Shipping it', status: 'git push, fingers crossed', dot }
    ],
    D,
    { loop: true }
  )}</g>`
  return wrap(th, 'blackscythe123 is coding', body)
}

// ================================================================= SLEEPING
/**
 * Story, played once then looped:
 *   finishes the task (tick) -> closes the lid -> laptop slides off stage -> big yawn
 *   -> hops aside -> a bed slides in -> hops onto the mattress -> lies down on its side
 *   -> blanket unrolls over it -> loop: breathing, snot bubble, Zzz.
 */
const BED = {
  x: 0, // bed centre, world x
  len: 100,
  dep: 54,
  frameH: 9,
  matH: 8
}
const MAT_TOP = BED.frameH + BED.matH

/** Every face of a box whose geometry changes over time, as SMIL-morphed paths. */
function animBox(at: (t: number) => Box, ts: number[], base: string, edge: string, o: AnimOpts, dyn = false, th?: Theme) {
  const faces = Array.from({ length: 6 }, () => ({ d: [] as string[], fill: [] as string[], op: [] as string[], shade: [] as string[] }))
  for (const t of ts) {
    const b = at(t)
    let k = 0
    const axes: Array<[V3, V3, V3]> = [
      [b.u, b.v, b.w],
      [b.v, b.w, b.u],
      [b.w, b.u, b.v]
    ]
    for (const [a, e1, e2] of axes)
      for (const s of [1, -1]) {
        const n = norm(scl(a, s))
        const fc = add(b.c, scl(a, s))
        const pts: V3[] = [
          add(add(fc, e1), e2),
          add(add(fc, e1), scl(e2, -1)),
          add(add(fc, scl(e1, -1)), scl(e2, -1)),
          add(add(fc, scl(e1, -1)), e2)
        ]
        const f = faces[k++]!
        f.d.push(poly(pts))
        f.fill.push(litColor(base, n))
        f.op.push(dot(n, VIEW) > 0.001 ? '1' : '0')
        f.shade.push(n2(clamp(0.5 - 0.6 * Math.max(0, dot(n, LIGHT)), 0, 0.55)))
      }
  }
  return faces
    .map((f) => {
      if (f.op.every((v) => v === '0')) return ''
      const opA = anim('animate', 'opacity', f.op, o)
      const dA = anim('animate', 'd', f.d, o)
      if (dyn && th)
        return `<g opacity="${f.op[0]}">${opA}<path d="${f.d[0]}" fill="${palCol(th)}" class="dyn-fill" stroke="#000" stroke-opacity=".25" stroke-width=".6" stroke-linejoin="round">${dA}</path><path d="${f.d[0]}" fill="#000" opacity="${f.shade[0]}">${dA}</path></g>`
      return `<path d="${f.d[0]}" fill="${f.fill[0]}" stroke="${edge}" stroke-width=".6" stroke-linejoin="round" opacity="${f.op[0]}">${dA}${anim('animate', 'fill', f.fill, o)}${opA}</path>`
    })
    .join('')
}

function lidAt(phi: number): Box {
  const dir: V3 = [0, Math.sin(phi), Math.cos(phi)]
  const back: V3 = [0, -Math.cos(phi), Math.sin(phi)]
  return {
    c: add(add(HINGE, scl(dir, LL / 2)), scl(back, LTH / 2)),
    u: [LW / 2 - 0.5, 0, 0],
    v: scl(dir, LL / 2),
    w: scl(back, LTH / 2)
  }
}

/** Logo on the lid's back, re-projected each frame as the lid swings shut. */
function lidLogoD(phi: number) {
  const dir: V3 = [0, Math.sin(phi), Math.cos(phi)]
  const back: V3 = [0, -Math.cos(phi), Math.sin(phi)]
  const o3 = add(add(HINGE, scl(dir, LL * 0.52)), scl(back, LTH + 0.05))
  const k = 0.085
  let d = ''
  NUAGE.forEach((r, i) => {
    const a = (i / NUAGE.length) * Math.PI * 2
    const lx = r * 100 * Math.cos(a) * k
    const ly = r * 100 * Math.sin(a) * k
    // logo-local x -> world +x, logo-local y (down) -> down the lid
    const p = proj(add(add(o3, [lx, 0, 0]), scl(dir, -ly)))
    d += (i ? 'L' : 'M') + n1(p.x) + ' ' + n1(p.y)
  })
  return d + 'Z'
}

// ---- 2D affine helpers (the bot is a flat sprite we place in 3D by its matrix)
type M2 = [number, number, number, number, number, number] // a b c d e f
const mmul = (p: M2, q: M2): M2 => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5]
]
const mT = (x: number, y: number): M2 => [1, 0, 0, 1, x, y]
const mS = (x: number, y: number): M2 => [x, 0, 0, y, 0, 0]
const mR = (deg_: number): M2 => {
  const a = deg(deg_)
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]
}
const mApply = (m: M2, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
/** M = translate . rotate . skewX . scale — each part is animatable with animateTransform. */
function decompose(m: M2) {
  const [a, b, c, d, e, f] = m
  const sx = Math.hypot(a, b)
  const rot = (Math.atan2(b, a) * 180) / Math.PI
  const c2 = (a * c + b * d) / sx
  const sy = (a * d - b * c) / sx
  const skew = (Math.atan2(c2, sy) * 180) / Math.PI
  return { e, f, rot, skew, sx, sy }
}
function matrixAnim(ms: M2[], o: AnimOpts, inner: string) {
  const parts = ms.map(decompose)
  // keep the rotation continuous (no 359 -> 0 jumps)
  for (let i = 1; i < parts.length; i++) {
    while (parts[i]!.rot - parts[i - 1]!.rot > 180) parts[i]!.rot -= 360
    while (parts[i]!.rot - parts[i - 1]!.rot < -180) parts[i]!.rot += 360
  }
  const p0 = parts[0]!
  return `<g transform="translate(${n1(p0.e)} ${n1(p0.f)})">${anim('animateTransform', 'transform', parts.map((p) => `${n1(p.e)} ${n1(p.f)}`), o, 'translate')}<g transform="rotate(${n1(p0.rot)})">${anim('animateTransform', 'transform', parts.map((p) => n1(p.rot)), o, 'rotate')}<g transform="skewX(${n1(p0.skew)})">${anim('animateTransform', 'transform', parts.map((p) => n1(p.skew)), o, 'skewX')}<g transform="scale(${n2(p0.sx)} ${n2(p0.sy)})">${anim('animateTransform', 'transform', parts.map((p) => `${n2(p.sx)} ${n2(p.sy)}`), o, 'scale')}${inner}</g></g></g></g>`
}

function sleepingCard(th: Theme) {
  const I = 9.6 // the story, once
  const L = 6 // the sleep loop
  const ti = times(I)
  const oi: AnimOpts = { dur: I, freeze: true }

  // ---- beats
  const DONE = 1.5
  const LID_A = 2.55
  const LID_B = 3.1
  const LAP_A = 3.2
  const LAP_B = 3.95
  const YAWN_A = 3.3
  const YAWN_B = 4.15
  const HOP1_A = 4.3
  const HOP1_B = 4.78
  const BED_A = 4.75
  const BED_B = 5.6
  const HOP2_A = 6.1
  const HOP2_B = 6.7
  const LIE_A = 6.95 // leans back onto the pillow
  const LIE_B = 7.6
  const BLK_A = 7.7 // blanket pulled up to the chin
  const BLK_B = 8.6
  const EYES_OFF = 7.3

  const cues: Cue[] = [
    { t: -6, expr: expr('attentif'), look: AT_SCREEN },
    { t: DONE, expr: expr('heureux'), look: AT_VIEWER, lookMorph: 0.4 },
    { t: 2.45, expr: expr('somnolent'), look: look(-12, -22, 0.1), lookMorph: 0.5 },
    { t: YAWN_A, expr: SHUT, look: look(0, 10, 0), lookMorph: 0.5 },
    { t: YAWN_B, expr: expr('somnolent'), look: look(22, -12, 0.2), lookMorph: 0.4 },
    { t: BED_A, expr: expr('curieux'), look: look(-34, -8, 0.2), lookMorph: 0.35 },
    { t: BED_B - 0.1, expr: expr('heureux'), look: look(-28, -12, 0.15), lookMorph: 0.4 },
    { t: 5.95, expr: expr('somnolent'), look: look(-10, -6, 0.1), lookMorph: 0.4 },
    { t: LIE_A, expr: SHUT, look: look(0, 0, 0), lookMorph: 0.5 }
  ]
  const eyes = sampleEyes(cues, I)
  const closedAt = eyes[Math.round(EYES_OFF * FPS)]!

  const bx = BED.x
  const P0 = mFoot
  const F = proj([56, 0, 8]) // aside, right of where the bed lands
  // lying: the sprite's plane reclines on the mattress, head up the pillow, face to the ceiling
  const BETA = deg(13) // almost flat: lying down, head just raised by the pillow
  const UP: V3 = [-Math.cos(BETA), Math.sin(BETA), 0] // sprite "up" in the world
  const C: V3 = [bx - 13, MAT_TOP + 6.5, 1] // sprite centre in the world, sunk into the mattress
  const B = proj([C[0] + 14, MAT_TOP, 1]) // where it lands, sitting, before lying back
  const lieM = (() => {
    const o = proj(C)
    let ax = proj(add(C, [0, 0, MS]))
    const ay = proj(add(C, scl(UP, -MS)))
    let m: M2 = [ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y]
    if (m[0] * m[3] - m[1] * m[2] < 0) {
      ax = proj(add(C, [0, 0, -MS]))
      m = [ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y]
    }
    return m
  })()

  const typingS = (t: number) => env(t, -1, DONE + 0.05, 0.25)
  const h = BODY_BOTTOM * MS
  const upright = (t: number): M2 => {
    let x = P0.x
    let y = P0.y
    let rot = 0
    let sx = 1
    let sy = 1
    const b = Math.abs(Math.sin(Math.PI * 4.25 * t))
    y -= b * 1.5 * typingS(t)
    sy -= 0.02 * b * typingS(t)
    rot -= 3.5 * typingS(t)
    y -= 6 * bump(t, DONE, DONE + 0.35)
    rot -= 8 * env(t, LID_A - 0.1, LID_B + 0.1, 0.2)
    const yawn = env(t, YAWN_A, YAWN_B, 0.3)
    sy += 0.14 * yawn
    sx -= 0.08 * yawn
    const hop = (a: number, bb: number, from: { x: number; y: number }, to: { x: number; y: number }, hh: number) => {
      if (t < a) return
      const u = clamp((t - a) / (bb - a))
      x = lerp(from.x, to.x, smooth(u))
      y = lerp(from.y, to.y, u) - hh * Math.sin(u * Math.PI)
      sy += 0.08 * Math.sin(u * Math.PI)
      sx -= 0.05 * Math.sin(u * Math.PI)
    }
    hop(HOP1_A, HOP1_B, P0, F, 14)
    hop(HOP2_A, HOP2_B, F, B, 20)
    for (const [a, bb] of [
      [HOP1_A, HOP1_B],
      [HOP2_A, HOP2_B]
    ] as const) {
      const pre = bump(t, a - 0.22, a)
      const land = bump(t, bb, bb + 0.24)
      sy -= 0.1 * pre + 0.12 * land
      sx += 0.07 * pre + 0.09 * land
    }
    // feet at (x, y); rotate about the body centre, squash about the feet
    return [mT(x, y), mT(0, -h), mR(rot), mT(0, h), mS(sx, sy), mT(0, -h), mS(MS, MS)].reduce(mmul)
  }
  const mats = ti.map((t) => {
    const up = upright(Math.min(t, LIE_A))
    if (t <= LIE_A) return upright(t)
    const u = smooth((t - LIE_A) / (LIE_B - LIE_A))
    // settles into the mattress with a soft sink after landing
    const sink = 1 - 0.06 * bump(t, LIE_B - 0.1, LIE_B + 0.35)
    const m = up.map((v, i) => lerp(v, lieM[i]!, u)) as M2
    return mmul(mmul(mT(m[4], m[5]), mS(1, sink)), [m[0], m[1], m[2], m[3], 0, 0])
  })

  // ---- face extras (sprite-local units)
  const mc = closedAt.centers
  const mouthX = (mc[0]!.x + mc[1]!.x) / 2 + 4
  const mouthY = (mc[0]!.y + mc[1]!.y) / 2 + 24
  const yawnM = (t: number) => env(t, YAWN_A + 0.05, YAWN_B - 0.05, 0.3)
  const mouth = `<ellipse cx="${n1(mouthX)}" cy="${n1(mouthY)}" rx="4" ry="0" fill="${th.ink}">${anim(
    'animate',
    'ry',
    ti.map((t) => n1(15 * yawnM(t) + 2.2 * smooth((t - LIE_B) / 0.4))),
    oi
  )}${anim('animate', 'rx', ti.map((t) => n1(4 + 7 * yawnM(t) - 0.5 * smooth((t - LIE_B) / 0.4))), oi)}</ellipse>`
  const arcs = closedAt.centers
    .map(
      (c) =>
        `<path d="M${n1(c.x - 12)} ${n1(c.y - 2)}Q${n1(c.x)} ${n1(c.y + 11)} ${n1(c.x + 12)} ${n1(c.y - 2)}" fill="none" stroke="${th.ink}" stroke-width="6.5" stroke-linecap="round"/>`
    )
    .join('')
  const eyesOpen = eyesMarkup(th, eyes, oi, ` opacity="1"`).replace(
    /^<g opacity="1">/,
    `<g opacity="1"><set attributeName="opacity" to="0" begin="${EYES_OFF}s" fill="freeze"/>`
  )
  const eyesShut = `<g opacity="0"><set attributeName="opacity" to="1" begin="${EYES_OFF}s" fill="freeze"/>${arcs}</g>`
  const bubble = `<g opacity="0"><set attributeName="opacity" to="1" begin="${I}s" fill="freeze"/><circle cx="${n1(mouthX + 15)}" cy="${n1(mouthY + 4)}" r="3" fill="#cfe9ff" fill-opacity=".35" stroke="#f2f8ff" stroke-opacity=".95" stroke-width="3.2"><animate attributeName="r" begin="${I}s" dur="${L / 2}s" repeatCount="indefinite" keyTimes="0;.5;1" values="3;16;3" keySplines=".45 0 .55 1;.45 0 .55 1" calcMode="spline"/></circle></g>`
  // breathing, in the sprite's own frame: the chest rises
  const breath = `<animateTransform attributeName="transform" type="scale" begin="${I}s" dur="${L / 2}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values="1 1;1.04 1.035;1 1"/>`
  const screenLight = ti.map((t) => n2(clamp(0.9 * (1 - smooth((t - LID_A) / 0.45)))))
  // lying flat the body needs its thickness: stacked copies down the screen, in sprite space
  const det = lieM[0] * lieM[3] - lieM[1] * lieM[2]
  const down = { x: -lieM[2] / det, y: lieM[0] / det } // sprite-local vector that moves 1 px down the screen
  const lieIn = ti.map((t) => n2(smooth((t - LIE_A - 0.25) / (LIE_B - LIE_A - 0.25))))
  const extrusion = `<g opacity="0">${anim('animate', 'opacity', lieIn, oi)}${[7, 5.6, 4.2, 2.8, 1.4]
    .map((k) => `<g transform="translate(${n1(down.x * k)} ${n1(down.y * k)})"><path d="${BODY}" fill="${palCol(th)}" class="dyn-fill"/><path d="${BODY}" fill="#000" opacity="${n2(0.18 + k * 0.025)}"/></g>`)
    .join('')}</g>`
  const mascot = matrixAnim(
    mats,
    oi,
    `<g>${breath}
${extrusion}
${bodyLayers(th, '')}
<g clip-path="url(#bodyClip)"><rect x="-120" y="-120" width="240" height="240" fill="url(#screenLight)" opacity="0">${anim('animate', 'opacity', screenLight, oi)}</rect></g>
${eyesOpen}${eyesShut}${mouth}${bubble}</g>`
  )
  const footAt = ti.map((t) => {
    const m = mats[Math.round((t / I) * (ti.length - 1))]!
    return mApply(m, 0, BODY_BOTTOM)
  })
  const mShadow = `<ellipse cx="0" cy="1" rx="30" ry="7" fill="#000" opacity="${th.shadow}" filter="url(#soft)">${anim(
    'animate',
    'opacity',
    ti.map((t) => n2(th.shadow * (1 - smooth((t - HOP2_A) / 0.3)))),
    oi
  )}${anim('animateTransform', 'transform', footAt.map((p) => `${n1(p.x)} ${n1(p.y)}`), oi, 'translate')}</ellipse>`

  // ---- laptop: lid swings shut, then it slides off stage
  const phiAt = (t: number) => lerp(LID_ANGLE, Math.PI - 0.03, easeIn(clamp((t - LID_A) / (LID_B - LID_A))))
  const lidFaces = animBox((t) => lidAt(phiAt(t)), ti, th.metal, th.metalEdge, oi)
  const logo = `<path d="${lidLogoD(phiAt(0))}" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)">${anim('animate', 'd', ti.map((t) => lidLogoD(phiAt(t))), oi)}</path>`
  const halo = `<path d="${poly(lidCorners(3))}" class="dyn-fill" fill="${palCol(th)}" filter="url(#softer)" opacity=".55">${anim(
    'animate',
    'opacity',
    ti.map((t) => n2(0.55 * (1 - smooth((t - LID_A) / 0.4)))),
    oi
  )}</path>`
  const badgeP = proj(add(HINGE, scl(LID_DIR, LL + 14)))
  const kt = (a: number) => n2(a / I)
  const badge = `<g transform="translate(${n1(badgeP.x + 6)} ${n1(badgeP.y)})"><g opacity="0">
<animate attributeName="opacity" dur="${I}s" fill="freeze" keyTimes="0;${kt(DONE)};${kt(DONE + 0.15)};${kt(2.3)};${kt(2.6)};1" values="0;0;1;1;0;0"/>
<animateTransform attributeName="transform" type="scale" dur="${I}s" fill="freeze" keyTimes="0;${kt(DONE)};${kt(DONE + 0.2)};${kt(DONE + 0.35)};1" values="0;0;1.25;1;1"/>
<circle r="8.5" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)"/>
<path d="M-3.8 0.2L-1.2 2.8L4 -2.6" fill="none" stroke="${th.mode === 'dark' ? '#15121b' : '#ffffff'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></g>`
  const lapSlide = anim('animateTransform', 'transform', ti.map((t) => `${n1(-175 * easeIn(clamp((t - LAP_A) / (LAP_B - LAP_A))))} 0`), oi, 'translate')
  const lapShadowPts: V3[] = [
    [LW / 2 + 4, 0, LD / 2 + 6],
    [-LW / 2 - 4, 0, LD / 2 + 6],
    [-LW / 2 - 4, 0, -LD / 2 - 4],
    [LW / 2 + 4, 0, -LD / 2 - 4]
  ]
  const laptop = `<g>${lapSlide}<path d="${poly(lapShadowPts)}" fill="#000" opacity="${th.shadow * 0.8}" filter="url(#softer)"/>${boxFaces(deck, th.metal, th.metalEdge)}${halo}${lidFaces}${logo}</g>`

  // ---- bed (real boxes), slides in from the left
  const wood = th.mode === 'dark' ? '#5d5170' : '#b9abcc'
  const woodEdge = mix(wood, '#000000', 0.3)
  const sheet = th.mode === 'dark' ? '#e2ddec' : '#f7f4fb'
  const sheetEdge = mix(sheet, '#000000', 0.18)
  const frame: Box = { c: [bx, BED.frameH / 2 + 1.5, 0], u: [BED.len / 2, 0, 0], v: [0, BED.frameH / 2 - 1.5, 0], w: [0, 0, BED.dep / 2] }
  const legs = ([-1, 1] as const)
    .flatMap((sx) => ([-1, 1] as const).map((sz) => ({ c: [bx + sx * (BED.len / 2 - 3), 1.5, sz * (BED.dep / 2 - 3)] as V3, u: [2, 0, 0] as V3, v: [0, 1.5, 0] as V3, w: [0, 0, 2] as V3 })))
    .map((b) => boxFaces(b, wood, woodEdge))
    .join('')
  const head: Box = { c: [bx - BED.len / 2 - 2, 17, 0], u: [2.5, 0, 0], v: [0, 17, 0], w: [0, 0, BED.dep / 2 + 1] }
  const footB: Box = { c: [bx + BED.len / 2 + 1.5, 9, 0], u: [1.8, 0, 0], v: [0, 9, 0], w: [0, 0, BED.dep / 2 + 1] }
  const mat: Box = { c: [bx, BED.frameH + BED.matH / 2, 0], u: [BED.len / 2 - 1, 0, 0], v: [0, BED.matH / 2, 0], w: [0, 0, BED.dep / 2 - 1.5] }
  const pillowBox: Box = { c: [bx - BED.len / 2 + 12, MAT_TOP + 3.2, 0], u: [7.5, 0, 0], v: [0, 2.6, 0], w: [0, 0, 15] }
  const pillowBase = proj([pillowBox.c[0], MAT_TOP, 0])
  // the pillow squishes when the head lands on it
  const pillow = `<g transform="translate(${n1(pillowBase.x)} ${n1(pillowBase.y)})"><g>${anim(
    'animateTransform',
    'transform',
    ti.map((t) => {
      const k = smooth((t - LIE_B + 0.25) / 0.35)
      const wob = Math.exp(-Math.max(0, t - LIE_B) * 7) * Math.sin(Math.max(0, t - LIE_B) * 22) * 0.06 * k
      return `${n2(1 + 0.1 * k - wob)} ${n2(1 - 0.32 * k + wob)}`
    }),
    oi,
    'scale'
  )}<g transform="translate(${n1(-pillowBase.x)} ${n1(-pillowBase.y)})">${boxFaces(pillowBox, sheet, sheet).replace(/stroke-width="\.6"/g, 'stroke-width="4.5"')}</g></g></g>`
  // the mattress gives under the body: a soft dent around where it lies
  const dentC = proj([C[0] + 4, MAT_TOP, 1])
  const dent = `<ellipse cx="${n1(dentC.x)}" cy="${n1(dentC.y)}" rx="34" ry="9" transform="rotate(${n1((Math.atan2(-sa * sp, ca) * 180) / Math.PI)} ${n1(dentC.x)} ${n1(dentC.y)})" fill="#000" opacity="0" filter="url(#soft)">${anim('animate', 'opacity', lieIn.map((v) => n2(Number(v) * (th.mode === 'dark' ? 0.4 : 0.22))), oi)}</ellipse>`
  const bedShadow: V3[] = [
    [bx + BED.len / 2 + 6, 0, BED.dep / 2 + 6],
    [bx - BED.len / 2 - 6, 0, BED.dep / 2 + 6],
    [bx - BED.len / 2 - 6, 0, -BED.dep / 2 - 4],
    [bx + BED.len / 2 + 6, 0, -BED.dep / 2 - 4]
  ]
  const bedSlide = anim('animateTransform', 'transform', ti.map((t) => `${n1(-190 * (1 - easeOut(clamp((t - BED_A) / (BED_B - BED_A)))))} 0`), oi, 'translate')
  const bed = `<path d="${poly(bedShadow)}" fill="#000" opacity="${th.shadow * 0.9}" filter="url(#softer)"/>
${boxFaces(head, wood, woodEdge)}${legs}${boxFaces(frame, wood, woodEdge)}${boxFaces(mat, sheet, sheetEdge)}${pillow}${boxFaces(footB, wood, woodEdge)}`

  // ---- quilt: a real surface z(x) with a hump where the body is, built as strips back -> front
  const footX = bx + BED.len / 2 + 0.5
  const half = BED.dep / 2 + 1
  const hump = (x: number) => 13 * Math.exp(-(((x - (C[0] + 12)) / 15) ** 2))
  const qh = (x: number, z: number) => MAT_TOP + 1.2 + hump(x) * (1 - 0.75 * (z / half) ** 2)
  const reach = (t: number) => lerp(footX - 2, C[0] + 21, easeOut(clamp((t - BLK_A) / (BLK_B - BLK_A))))
  const NX = 14
  const ZS = [-half, -half / 2, 0, half / 2, half]
  const strip = (x0: number, x1: number, z0: number, z1: number, lift = 0) => {
    const xs = Array.from({ length: NX + 1 }, (_, i) => lerp(x0, x1, i / NX))
    const back = xs.map((x) => [x, qh(x, z0) + lift, z0] as V3)
    const front = xs.map((x) => [x, qh(x, z1) + lift, z1] as V3).reverse()
    return poly([...back, ...front])
  }
  const qOpts = oi
  const qStrips = ZS.slice(0, -1)
    .map((z0, i) => {
      const z1 = ZS[i + 1]!
      const ds = ti.map((t) => strip(reach(t), footX, z0, z1))
      // the ridge faces the key light; the far and near flanks fall off
      const shade = [0.3, 0.12, 0.04, 0.22][i]!
      return `<path d="${ds[0]}" fill="${palCol(th)}" class="dyn-fill">${anim('animate', 'd', ds, qOpts)}</path><path d="${ds[0]}" fill="#000" opacity="${shade}">${anim('animate', 'd', ds, qOpts)}</path>`
    })
    .join('')
  const drapeD = ti.map((t) => {
    const x0 = reach(t)
    const xs = Array.from({ length: NX + 1 }, (_, i) => lerp(x0, footX, i / NX))
    const top = xs.map((x) => [x, qh(x, half), half] as V3)
    const bottom = [...xs].reverse().map((x) => [x, BED.frameH + 1, half + 0.6] as V3)
    return poly([...top, ...bottom])
  })
  const drape = `<path d="${drapeD[0]}" fill="${palCol(th)}" class="dyn-fill">${anim('animate', 'd', drapeD, qOpts)}</path><path d="${drapeD[0]}" fill="#000" opacity=".38">${anim('animate', 'd', drapeD, qOpts)}</path>`
  // white sheet turned down over the edge, at the chin
  const foldD = ti.map((t) => {
    const x0 = reach(t)
    return ZS.slice(0, -1).map((z0, i) => strip(x0 - 0.5, x0 + 5.5, z0, ZS[i + 1]!, 0.7)).join('')
  })
  const fold = `<path d="${foldD[0]}" fill="${sheet}" stroke="${sheetEdge}" stroke-width=".6" stroke-linejoin="round">${anim('animate', 'd', foldD, qOpts)}</path>`
  // the quilt rises and falls with each breath
  const qBase = proj([C[0] + 12, MAT_TOP, 0])
  const qBreath = `<animateTransform attributeName="transform" type="scale" additive="sum" begin="${I}s" dur="${L / 2}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values="1 1;1 1.04;1 1"/>`
  const quilt = `<g opacity="0"><set attributeName="opacity" to="1" begin="${BLK_A}s" fill="freeze"/><g transform="translate(${n1(qBase.x)} ${n1(qBase.y)})"><g>${qBreath}<g transform="translate(${n1(-qBase.x)} ${n1(-qBase.y)})">${drape}${qStrips}${fold}</g></g></g></g>`

  // Zzz from the head on the pillow
  const headP = proj(add(C, scl(UP, MS * 80)))
  const zs = [0, 1, 2]
    .map((i) => {
      const b = I + 0.2 + i * (L / 3)
      return `<text x="0" y="0" font-family="'Segoe UI',Arial,sans-serif" font-weight="800" font-size="${11 + i * 3.5}" fill="${palCol(th)}" class="dyn-fill" opacity="0">z<animate attributeName="opacity" begin="${b}s" dur="${L}s" repeatCount="indefinite" keyTimes="0;.12;.4;.55;1" values="0;1;.8;0;0"/><animateTransform attributeName="transform" type="translate" begin="${b}s" dur="${L}s" repeatCount="indefinite" keyTimes="0;.55;1" values="0 0;14 -30;14 -30"/></text>`
    })
    .join('')
  const zzz = `<g transform="translate(${n1(headP.x + 4)} ${n1(headP.y - 10)})">${zs}</g>`

  // ---- captions, in step with the story, then a slow rotation of sleepy statuses
  const idle = idleDot(th)
  const story = captions(
    th,
    [
      { a: 0, b: DONE, title: 'Last commit', status: 'one more line, promise', dot: liveDot(th) },
      { a: DONE, b: LID_A, title: 'Done &amp; dusted', status: 'tests green, brain fried', dot: liveDot(th) },
      { a: LID_A, b: HOP1_A, title: 'Logging off', status: 'laptop says goodnight', dot: idle },
      { a: HOP1_A, b: BED_B, title: 'Bedtime!', status: 'a wild bed appeared', dot: idle },
      { a: BED_B, b: BLK_A, title: 'Tucking in', status: 'fluffing the pillow', dot: idle },
      { a: BLK_A, b: I, title: 'Fast asleep' }
    ],
    I,
    { hold: true }
  )
  const dreams = captions(
    th,
    [
      { a: 0, b: 6, status: 'do not disturb (srsly)', dot: idle },
      { a: 6, b: 12, status: 'dreaming in code', dot: idle },
      { a: 12, b: 18, status: 'zzz&#8230; merge conflicts&#8230;', dot: idle }
    ],
    18,
    { begin: BLK_A + 0.2, loop: true }
  )

  const body = `<clipPath id="stage"><rect x="0" y="0" width="172" height="${H}"/></clipPath><g clip-path="url(#stage)">
<g transform="translate(-190 0)">${bedSlide}${bed}</g>
${dent}
${mShadow}
${mascot}
${quilt}
${laptop}
${badge}
${zzz}
</g>
${label(th)}<g ${FONT}>${story}${dreams}</g>`
  return wrap(th, 'blackscythe123 is sleeping', body)
}

// ================================================================= SPOTIFY OFFLINE
/**
 * DJ Simiyon, offline. Same volume-shaded Bloub as the coding/sleeping cards, no limbs,
 * wearing AirPods. Story (16 s loop):
 *   listens for music (taps an AirPod, looks around) -> sad, nothing plays -> idea!
 *   -> sings its own playlist (notes, sound waves from the AirPods) -> encore flip with
 *   hearts -> shy wink -> yawns, power nap with Zzz -> startles awake -> loop.
 */
function spotifyCard(th: Theme) {
  const D = 16
  const ts = times(D)
  const o: AnimOpts = { dur: D, loop: true }
  const S = 0.4 // a bit bigger than on the other cards: it is the star here
  const base = { x: 74, y: 112 } // where its bottom touches the floor
  const h = BODY_BOTTOM * S

  // ---- beats
  const LISTEN_B = 3.0
  const SAD_B = 5.0
  const IDEA_B = 5.8
  const SING_B = 10.0
  const FLIP_B = 11.2
  const SHY_B = 13.2
  const YAWN_B = 14.3
  const WAKE = 15.55

  const cues: Cue[] = [
    { t: -6, expr: expr('curieux'), look: look(-26, 6, 0.5) },
    { t: 1.5, look: look(28, 8, 0.5), lookMorph: 0.45 },
    { t: 2.4, expr: expr('curieux'), look: look(-6, 4, 0.3), lookMorph: 0.4 },
    { t: LISTEN_B, expr: expr('attentif'), look: look(0, -20, 0.15), lookMorph: 0.5 },
    { t: SAD_B, expr: expr('attentif'), look: look(0, 16, 0.2), lookMorph: 0.15 },
    { t: SAD_B + 0.35, expr: expr('attentif'), look: look(4, 14, 0.25), lookMorph: 0.2 },
    { t: IDEA_B, expr: expr('attentif'), look: look(0, -2, 0.3), lookMorph: 0.3 },
    { t: SING_B, expr: expr('attentif'), look: look(0, -2, 0.2), lookMorph: 0.3 },
    { t: FLIP_B, expr: expr('excite'), look: look(0, 6, 0.3), lookMorph: 0.3 },
    { t: 12.45, expr: expr('attentif'), look: look(-4, 2, 0.2), lookMorph: 0.25 },
    { t: SHY_B, expr: SHUT, look: look(0, 14, 0), lookMorph: 0.4 },
    { t: YAWN_B, expr: expr('somnolent'), look: look(0, -8, 0.1), lookMorph: 0.4 },
    { t: 14.8, expr: SHUT, look: look(0, -18, 0), lookMorph: 0.5 },
    { t: WAKE, expr: expr('attentif'), look: look(-10, 6, 0.3), lookMorph: 0.12 },
    { t: 15.85, expr: expr('curieux'), look: look(-26, 6, 0.5), lookMorph: 0.3 }
  ]
  const eyes = sampleEyes(cues, D, 0.4)

  // ---- body choreography (everything settles back to rest by t = D)
  const pose = ts.map((t) => {
    let dy = 0
    let rot = 0
    let sx = 1
    let sy = 1
    // always: soft breathing
    const br = Math.sin((t / D) * Math.PI * 2 * 4)
    sy += 0.012 * br
    sx -= 0.008 * br
    // listening: head tilts, straining to hear
    const listen = env(t, 0.2, LISTEN_B, 0.3)
    rot += 9 * Math.sin(t * 2.6) * listen
    // sad: deflates
    const sad = env(t, LISTEN_B, SAD_B, 0.4)
    sy -= 0.08 * sad
    sx += 0.05 * sad
    dy += 2 * sad
    rot -= 4 * sad
    // idea: pops up
    const pop = bump(t, SAD_B + 0.1, SAD_B + 0.55)
    dy -= 12 * pop
    sy += 0.08 * pop
    sx -= 0.05 * pop
    // singing: sways and bounces on the beat (2 beats a second)
    const sing = env(t, IDEA_B, SING_B, 0.3)
    rot += 9 * Math.sin(t * Math.PI * 2 * 0.5) * sing
    const beat = Math.abs(Math.sin(t * Math.PI * 2))
    dy -= 4 * beat * sing
    sy += 0.05 * (1 - beat) * sing - 0.02 * beat * sing
    sx -= 0.035 * (1 - beat) * sing
    // encore: crouch, jump, full flip, land
    const pre = bump(t, SING_B, SING_B + 0.22)
    sy -= 0.14 * pre
    sx += 0.1 * pre
    // a big happy jump: stretch on the way up, a little wiggle at the top
    if (t > SING_B + 0.22 && t < SING_B + 0.95) {
      const u = (t - SING_B - 0.22) / 0.73
      dy -= 26 * Math.sin(u * Math.PI)
      sy += 0.12 * Math.sin(u * Math.PI) * (1 - bump(u, 0.35, 0.65))
      sx -= 0.08 * Math.sin(u * Math.PI) * (1 - bump(u, 0.35, 0.65))
      rot += 7 * Math.sin(u * Math.PI * 4) * bump(u, 0.25, 0.75)
    }
    const land = bump(t, SING_B + 0.95, SING_B + 1.2)
    sy -= 0.15 * land
    sx += 0.11 * land
    // still vibing: three little bops, left, right, home
    let dx = 0
    const bops: Array<[number, number, number, number]> = [
      [11.3, 11.72, 0, -12],
      [11.8, 12.22, -12, 12],
      [12.3, 12.72, 12, 0]
    ]
    for (const [a, b, x0, x1] of bops) {
      if (t >= a && t <= b) {
        const u = (t - a) / (b - a)
        dx = lerp(x0, x1, smooth(u))
        dy -= 9 * Math.sin(u * Math.PI)
        rot += Math.sign(x1 - x0) * 8 * Math.sin(u * Math.PI)
        sy += 0.06 * Math.sin(u * Math.PI)
        sx -= 0.04 * Math.sin(u * Math.PI)
      } else if (t > b && t < b + 0.12) {
        dx = x1
        const l = Math.sin(((t - b) / 0.12) * Math.PI)
        sy -= 0.08 * l
        sx += 0.06 * l
      }
    }
    if (t > 11.72 && t < 11.8) dx = -12
    if (t > 12.22 && t < 12.3) dx = 12
    // yawn: big stretch
    const yawn = env(t, SHY_B, YAWN_B, 0.35)
    sy += 0.12 * yawn
    sx -= 0.07 * yawn
    // power nap: slow nod
    const nap = env(t, 14.6, WAKE, 0.3)
    rot -= 7 * nap
    dy += 2.5 * nap
    // startle awake
    const jolt = bump(t, WAKE, WAKE + 0.3)
    dy -= 7 * jolt
    sy += 0.06 * jolt
    return { dx, dy, rot, sx, sy }
  })
  const tr = anim('animateTransform', 'transform', pose.map((p) => `${n1(p.dx)} ${n1(p.dy)}`), o, 'translate')
  const rt = anim('animateTransform', 'transform', pose.map((p) => `${n1(p.rot)} 0 ${n1(-h * 0.1)}`), o, 'rotate')
  const sc = anim('animateTransform', 'transform', pose.map((p) => `${n2(p.sx)} ${n2(p.sy)}`), o, 'scale')
  const shadowA =
    anim('animate', 'rx', pose.map((p) => n1(34 + p.dy * 0.6)), o) +
    anim('animate', 'opacity', pose.map((p) => n2(th.shadow * clamp(1 + p.dy / 40))), o)

  // ---- face extras, body-local units (ball radius 100)
  const c0 = eyes[0]!.centers
  const mx = (c0[0]!.x + c0[1]!.x) / 2 + 2
  const my = (c0[0]!.y + c0[1]!.y) / 2 + 34
  // mouth: smile / open, as one morphing shape (open = 0 draws just the smile line)
  const mouthParams = (t: number) => {
    let smile = 0.6
    let open = 0
    let w = 9
    const sad = env(t, LISTEN_B, SAD_B, 0.35)
    smile = lerp(smile, -0.7, sad)
    w = lerp(w, 7, sad)
    const listen = env(t, 0.2, LISTEN_B, 0.3)
    open = lerp(open, 0.25, listen) // little "oh?"
    w = lerp(w, 5, listen)
    smile = lerp(smile, 0.1, listen)
    const idea = env(t, SAD_B, IDEA_B, 0.15)
    open = lerp(open, 0.85, idea)
    smile = lerp(smile, 0.5, idea)
    w = lerp(w, 8, idea)
    const sing = env(t, IDEA_B, SING_B, 0.25)
    open = lerp(open, 0.25 + 0.55 * Math.abs(Math.sin(t * Math.PI * 3)), sing)
    smile = lerp(smile, 0.4, sing)
    w = lerp(w, 7, sing)
    const proud = env(t, SING_B, FLIP_B, 0.2)
    open = lerp(open, 0.35, proud)
    smile = lerp(smile, 0.9, proud)
    w = lerp(w, 7.5, proud)
    const bop = env(t, FLIP_B, SHY_B, 0.25)
    smile = lerp(smile, 0.9, bop)
    open = lerp(open, 0.3, bop)
    w = lerp(w, 7, bop)
    const yawn = env(t, SHY_B, YAWN_B, 0.3)
    open = lerp(open, 1.25, yawn)
    smile = lerp(smile, 0, yawn)
    w = lerp(w, 9, yawn)
    const nap = env(t, YAWN_B, WAKE, 0.3)
    open = lerp(open, 0.2, nap)
    smile = lerp(smile, 0, nap)
    w = lerp(w, 4, nap)
    const jolt = env(t, WAKE, D + 0.2, 0.1) * (1 - smooth((t - 15.8) / 0.2))
    open = lerp(open, 0.5, jolt)
    w = lerp(w, 5, jolt)
    return { smile, open, w }
  }
  const faceAt = (i: number) => {
    const c = eyes[i]!.centers
    return { x: (c[0]!.x + c[1]!.x) / 2 + 2, y: (c[0]!.y + c[1]!.y) / 2 + 26 }
  }
  const mouthD = ts.map((t, i) => {
    const { mx, my } = { mx: faceAt(i).x, my: faceAt(i).y }
    const { smile, open, w: w0 } = mouthParams(t)
    const w = w0 * 1.0
    const cy = -smile * 3.5
    const top = smile * 4.5
    const bot = top + open * 24
    const y0 = my + cy
    return `M${n1(mx - w)} ${n1(y0)}C${n1(mx - w * 0.45)} ${n1(my + top)} ${n1(mx + w * 0.45)} ${n1(my + top)} ${n1(mx + w)} ${n1(y0)}C${n1(mx + w * 0.95)} ${n1(my + bot)} ${n1(mx - w * 0.95)} ${n1(my + bot)} ${n1(mx - w)} ${n1(y0)}Z`
  })
  const tongueR = ts.map((t, i) => {
    const { open, w } = mouthParams(t)
    const f = faceAt(i)
    return { ry: n1(clamp((open - 0.45) / 0.6) * 8), rx: n1(w * 0.75), cy: n1(f.y + 9 + open * 11), cx: n1(f.x) }
  })
  const mouthClip = `<clipPath id="mouthClip"><path d="${mouthD[0]}">${anim('animate', 'd', mouthD, o)}</path></clipPath>`
  const mouth = `<path d="${mouthD[0]}" fill="${th.mode === 'dark' ? '#3a1427' : th.ink}" stroke="${th.ink}" stroke-width="5" stroke-linejoin="round">${anim('animate', 'd', mouthD, o)}</path>
<g clip-path="url(#mouthClip)"><ellipse cx="${tongueR[0]!.cx}" cy="${tongueR[0]!.cy}" rx="${tongueR[0]!.rx}" ry="${tongueR[0]!.ry}" fill="#ff8da1">${anim('animate', 'cx', tongueR.map((v) => v.cx), o)}${anim('animate', 'cy', tongueR.map((v) => v.cy), o)}${anim('animate', 'rx', tongueR.map((v) => v.rx), o)}${anim('animate', 'ry', tongueR.map((v) => v.ry), o)}</ellipse></g>`

  // blush: always a little, a lot when shy or proud
  const blushA = ts.map((t) => n2(0.35 + 0.4 * env(t, IDEA_B, SING_B, 0.3) + 0.6 * env(t, SING_B, SHY_B, 0.3) - 0.25 * env(t, LISTEN_B, SAD_B, 0.3)))
  const blush = [0, 1]
    .map((e) => {
      const cx = eyes.map((s) => n1(s.centers[e]!.x + (e ? 9 : -9)))
      const cy = eyes.map((s) => n1(s.centers[e]!.y + 30))
      return `<ellipse cx="${cx[0]}" cy="${cy[0]}" rx="16" ry="8.5" fill="#ff7fa8" filter="url(#soft)" opacity="${blushA[0]}">${anim('animate', 'opacity', blushA, o)}${anim('animate', 'cx', cx, o)}${anim('animate', 'cy', cy, o)}</ellipse>`
    })
    .join('')
  // ^ ^ while singing (one ^ for the wink), sleepy arcs during the nap; engine eyes fade out underneath
  const WINK_A = 12.45
  const happyW = [0, 1].map((e) =>
    ts.map((t) => Math.max(env(t, IDEA_B + 0.15, WINK_A + 0.05, 0.15), e === 1 ? env(t, WINK_A - 0.05, SHY_B, 0.12) : 0))
  )
  const sleepW = ts.map((t) => env(t, SHY_B + 0.1, WAKE, 0.15))
  // arcs share one baseline so the two eyes always sit level
  const arcD = (e: number, up: boolean) =>
    eyes.map((s) => {
      const c = s.centers[e]!
      const y = (s.centers[0]!.y + s.centers[1]!.y) / 2
      return up
        ? `M${n1(c.x - 10)} ${n1(y + 5)}C${n1(c.x - 10)} ${n1(y - 7.5)} ${n1(c.x + 10)} ${n1(y - 7.5)} ${n1(c.x + 10)} ${n1(y + 5)}`
        : `M${n1(c.x - 13)} ${n1(y)}C${n1(c.x - 11)} ${n1(y + 12)} ${n1(c.x + 11)} ${n1(y + 12)} ${n1(c.x + 13)} ${n1(y)}`
    })
  const arcPath = (d: string[], w: number[]) => {
    const op = w.map((v) => n2(v))
    return `<path d="${d[0]}" fill="none" stroke="${th.ink}" stroke-width="6.5" stroke-linecap="round" opacity="${op[0]}">${anim('animate', 'd', d, o)}${anim('animate', 'opacity', op, o)}</path>`
  }
  const arcs = [0, 1].map((e) => arcPath(arcD(e, true), happyW[e]!) + arcPath(arcD(e, false), sleepW)).join('')
  // engine eyes, one group per eye so the wink can close just one
  const eyesSvg = [0, 1]
    .map((e) => {
      const op = ts.map((_, i) => n2(1 - Math.max(happyW[e]![i]!, sleepW[i]!)))
      let g = `<g opacity="${op[0]}">${anim('animate', 'opacity', op, o)}<path d="${eyes[0]!.d[e]}" fill="${th.ink}">${anim('animate', 'd', eyes.map((x) => x.d[e]!), o)}</path>`
      if (th.spec) {
        const sp = eyes.map((x) => x.spec[e]!)
        g += `<circle cx="${n1(sp[0]!.x)}" cy="${n1(sp[0]!.y)}" r="${n1(sp[0]!.r)}" fill="${th.spec}" opacity=".9">${anim('animate', 'cx', sp.map((q) => n1(q.x)), o)}${anim('animate', 'cy', sp.map((q) => n1(q.y)), o)}${anim('animate', 'r', sp.map((q) => n1(q.r)), o)}</circle>`
      }
      return g + '</g>'
    })
    .join('')

  // AirPods Pro: tucked in behind the edge of the head (as if in an ear), stem hanging just
  // outside the body. Glossy white with pearl-grey falloff, a mic slit and a silver tip.
  const sideR = (side: number) => NUAGE[side > 0 ? 0 : Math.round(NUAGE.length / 2)]! * 100
  const podPos = (side: number) => ({ x: side * (sideR(side) - 11), y: -6 })
  const podDefs = `<defs>
<radialGradient id="podBud" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#f3f2f7"/><stop offset=".85" stop-color="#d4d2dc"/><stop offset="1" stop-color="#b4b1c0"/></radialGradient>
<linearGradient id="podBody" x1="0" y1="0" x2="1" y2=".35"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f2f1f6"/><stop offset="1" stop-color="#c8c6d2"/></linearGradient>
<linearGradient id="podStem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f1f0f5"/><stop offset="1" stop-color="#b9b6c5"/></linearGradient>
<linearGradient id="podTip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6e6ec"/><stop offset=".5" stop-color="#a9a8b4"/><stop offset="1" stop-color="#8d8b99"/></linearGradient>
</defs>`
  // AirPods as they really look when worn: the head is inside the ear, so all you see is a
  // short white stem hanging down (and a sliver of the bud), with a soft shadow where it goes in.
  const pod = (side: number) => {
    const { x, y } = podPos(side)
    const tap =
      side < 0
        ? anim('animateTransform', 'transform', ts.map((t) => `${n1(-8 * bump(t, 0.5, 0.75) - 8 * bump(t, 0.85, 1.1))}`), o, 'rotate')
        : ''
    const line = th.mode === 'dark' ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.24)'
    return `<g transform="translate(${n1(x)} ${y})"><g>${tap}<g transform="scale(${side} 1) rotate(12)">
<circle cx="3.2" cy="-1.5" r="7" fill="url(#podBud)" stroke="${line}" stroke-width="1"/>
<circle cx="1.2" cy="-4" r="2.1" fill="#fff"/>
<rect x="-3.8" y="-2" width="7.6" height="29" rx="3.8" fill="url(#podBody)" stroke="${line}" stroke-width="1"/>
<rect x="-3.8" y="24" width="7.6" height="3" rx="1.5" fill="#c4c1ce"/>
<rect x="-2.2" y="3" width="1.6" height="19" rx=".8" fill="#fff" opacity=".9"/>
<ellipse cx="1.5" cy="-3.5" rx="9" ry="4.2" fill="#000" opacity=".22" filter="url(#soft)"/>
</g></g></g>`
  }
  // the bud presses into the cheek: a soft contact shadow on the body next to each stem
  const podShadow = [-1, 1]
    .map((side) => {
      const { x, y } = podPos(side)
      return `<ellipse cx="${n1(x - side * 6)}" cy="${y + 22}" rx="4" ry="14" transform="rotate(${-side * 14} ${n1(x - side * 6)} ${y + 22})" fill="#000" opacity="${th.mode === 'dark' ? 0.16 : 0.14}" filter="url(#soft)"/>`
    })
    .join('')
  // little sound waves out of the AirPods while singing
  const waves = [-1, 1]
    .map((side) =>
      [0, 1].map((k) => {
        const kt = `0;${n2(IDEA_B / D)};${n2((IDEA_B + 0.3) / D)};${n2((SING_B - 0.3) / D)};${n2(SING_B / D)};1`
        return `<path d="M${side * (126 + k * 12)} -26 Q${side * (136 + k * 12)} -10 ${side * (126 + k * 12)} 6" fill="none" stroke="${palCol(th)}" class="dyn-stroke" stroke-width="4.5" stroke-linecap="round" opacity="0"><animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="${kt}" values="0;0;1;1;0;0"/><animate attributeName="stroke-opacity" dur=".5s" begin="${k * 0.25}s" repeatCount="indefinite" values=".2;1;.2"/></path>`
      })
    )
    .flat()
    .join('')

  // eyes swap to sleepy arcs during the nap (engine shut eyes are thin slivers otherwise)
  const mascot = `<g transform="translate(${base.x} ${n1(base.y - h)})"><g>${tr}<g>${rt}<g transform="translate(0 ${n1(h)})"><g>${sc}<g transform="translate(0 ${n1(-h)}) scale(${S})">
${podDefs}
${waves}
${bodyLayers(th, '')}
<g clip-path="url(#bodyClip)">${podShadow}</g>
${eyesSvg}
${arcs}
${mouth}
${pod(-1)}${pod(1)}
</g></g></g></g></g></g>`

  // ---- props that carry each mood (card space; head is around y = base.y - 2h)
  const hx = base.x
  const hy = base.y - 2 * h
  const kt = (t: number) => n2(clamp(t / D))
  const pop = (x: number, y: number, a: number, b: number, content: string, dx: number, dy: number, size: number, paint: string) =>
    `<g transform="translate(${n1(x)} ${n1(y)})"><g opacity="0"><animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(a)};${kt(a + 0.18)};${kt(b - 0.3)};${kt(b)};1" values="0;0;1;.9;0;0"/><animateTransform attributeName="transform" type="translate" dur="${D}s" repeatCount="indefinite" keyTimes="0;${kt(a)};${kt(b)};1" values="0 0;0 0;${n1(dx)} ${n1(dy)};${n1(dx)} ${n1(dy)}"/><text ${FONT} font-size="${size}" font-weight="800" text-anchor="middle" ${paint}>${content}</text></g></g>`
  const pal = `fill="${palCol(th)}" class="dyn-fill"`
  let fx = ''
  fx += pop(hx + 40, hy + 10, 0.9, 2.9, '?', 4, -8, 17, pal)
  fx += pop(hx - 38, hy + 18, 1.7, 2.9, '?', -3, -6, 12, pal)
  fx += pop(hx - 30, hy + 44, 3.4, 4.9, '&#128167;', -2, 10, 11, 'fill="#7cc7ff"')
  fx += pop(hx + 2, hy - 4, SAD_B + 0.1, IDEA_B + 0.2, '&#10022;', 0, -8, 18, pal)
  fx += pop(hx + 30, hy + 6, SAD_B + 0.2, IDEA_B + 0.2, '&#10022;', 4, -6, 10, pal)
  const notes = ['&#9834;', '&#9835;', '&#9833;', '&#9836;']
  let k = 0
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let t = IDEA_B + 0.15; t < SING_B - 0.6; t += 0.4) {
    const side = k % 2 ? 1 : -1
    fx += pop(hx + side * (36 + rnd() * 8), hy + 30, t, t + 1.8, notes[k++ % 4]!, side * (14 + rnd() * 16), -34 - rnd() * 12, 11 + rnd() * 5, pal)
  }
  for (let i = 0; i < 8; i++) {
    fx += pop(hx + (rnd() - 0.5) * 40, hy + 10, SING_B + 0.7 + i * 0.07, SING_B + 2.1 + i * 0.07, '&#10084;', (rnd() - 0.5) * 70, -18 - rnd() * 20, 9 + rnd() * 6, pal)
  }
  fx += pop(hx + 42, hy + 22, 12.3, 13.2, '&#10022;', 4, -4, 13, pal)
  fx += pop(hx + 50, hy + 34, 12.45, 13.2, '&#10022;', 3, -3, 8, pal)
  ;[0, 1, 2].forEach((i) => {
    fx += pop(hx + 30 + i * 6, hy + 14, 14.8 + i * 0.22, WAKE, i === 2 ? 'Z' : 'z', 12, -24, 11 + i * 3, pal)
  })
  fx += pop(hx + 34, hy + 8, WAKE, WAKE + 0.45, '!', 2, -6, 18, pal)

  const body = `${mouthClip}
<ellipse cx="${base.x}" cy="${base.y + 1}" rx="34" ry="7" fill="#000" opacity="${th.shadow}" filter="url(#soft)">${shadowA}</ellipse>
${mascot}
${fx}
<text x="178" y="44" ${FONT} font-size="10.5" font-weight="600" letter-spacing="2.2" fill="${th.muted}">DJ SIMIYON &#183; OFFLINE</text>
<g ${FONT}>${captions(
    th,
    [
      { a: 0, b: LISTEN_B, title: 'Hello? Music?', status: 'my AirPods hear nothing', dot: idleDot(th) },
      { a: LISTEN_B, b: SAD_B, title: 'No tunes&#8230;', status: 'Spotify went quiet on me', dot: idleDot(th) },
      { a: SAD_B, b: IDEA_B, title: 'Oh! Idea!', status: 'who needs wifi anyway', dot: idleDot(th) },
      { a: IDEA_B, b: SING_B, title: 'La la la &#9834;', status: 'singing my own playlist', dot: idleDot(th) },
      { a: SING_B, b: FLIP_B, title: 'Encore!', status: 'the crowd goes wild', dot: idleDot(th) },
      { a: FLIP_B, b: SHY_B, title: 'Still vibing', status: 'bopping to the silence', dot: idleDot(th) },
      { a: SHY_B, b: D, title: 'Power nap', status: 'dreaming of the next drop', dot: idleDot(th) }
    ],
    D,
    { loop: true }
  )}</g>`
  return wrap(th, 'Spotify offline', body)
}

/** GitHub serves these through <img>: one malformed tag and nothing renders at all. */
function assertWellFormed(name: string, svg: string) {
  const body = svg.replace(/<title>[^<]*<\/title>/, '').replace(/<style>[\s\S]*?<\/style>/, '')
  if (/&(?!amp;|lt;|gt;|quot;|#)/.test(body)) throw new Error(`${name}: bare &`)
  const stack: string[] = []
  for (const m of body.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m
    if (self) continue
    if (!close) stack.push(tag!)
    else if (stack.pop() !== tag) throw new Error(`${name}: mismatched </${tag}> at ${m.index}`)
  }
  if (stack.length) throw new Error(`${name}: unclosed ${stack.join(',')}`)
}

fs.mkdirSync(OUT, { recursive: true })
for (const th of THEMES) {
  for (const [name, svg] of [
    [`coding-${th.mode}.svg`, codingCard(th)],
    [`sleeping-${th.mode}.svg`, sleepingCard(th)],
    [`spotify-offline-${th.mode}.svg`, spotifyCard(th)]
  ] as const) {
    assertWellFormed(name, svg)
    fs.writeFileSync(path.join(OUT, name), svg)
    console.log(name.padEnd(20), (Buffer.byteLength(svg) / 1024).toFixed(1) + ' KB')
  }
}
