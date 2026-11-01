/**
 * Sphere-rig experiment: the mascot as a cluster of shaded spheres (a fully posable 3D body,
 * with feet, paws and headphones), instead of the engine's flat silhouette. Coding, sleeping
 * and spotify-offline, 360 x 130, dark + light. Read AGENTS.md first.
 *
 *   npx tsx studio/sphere-cards.ts                   # -> output/sphere/*.svg
 *
 * The mascot is a real 3D rig: the cloud silhouette is a cluster of spheres (puffs,
 * feet, paws, headphone cups), each one Lambert-shaded and depth-sorted every frame.
 * A sphere projects to a circle from any angle, so the bot can turn, recline into bed
 * or spin 360 degrees and stay solid. The face (eyes, mouth, blush) is mapped onto the
 * head sphere's surface, so it curves and foreshortens with the head. Blinks and gaze
 * drift come from the Bloub engine's `liveliness()`.
 *
 * Draw order can't be animated in SVG, so frames are split into runs that share the
 * same depth order; each run is its own layer stack, switched with `visibility`.
 *
 * Colour follows the README's 150 s palette lockstep (palettes.json).
 */
import fs from 'node:fs'
import path from 'node:path'
import { liveliness } from '../src/bot/face'

const OUT = process.env.OUT ?? 'output/sphere'
const PALETTES: Array<Record<string, string>> = JSON.parse(
  fs.readFileSync(process.env.PALETTES ?? 'studio/palettes.json', 'utf8')
)
const FPS = 15
const W = 360
const H = 130

// ================================================================= utils
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => {
  const x = clamp(t)
  return x * x * (3 - 2 * x)
}
const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3
const easeIn = (t: number) => clamp(t) ** 2
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI))
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
/** deterministic rng */
function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// ================================================================= themes + palette
interface Theme {
  mode: 'dark' | 'light'
  ink: string
  mouth: string
  metal: string
  metalEdge: string
  shadow: number
  muted: string
  wood: string
  sheet: string
  cup: string
}
const THEMES: Theme[] = [
  { mode: 'dark', ink: '#17131d', mouth: '#3a1427', metal: '#686377', metalEdge: '#8c87a0', shadow: 0.42, muted: '#9a95a8', wood: '#5d5170', sheet: '#e2ddec', cup: '#2c2735' },
  { mode: 'light', ink: '#fbf8ff', mouth: '#fbf8ff', metal: '#cfcbd8', metalEdge: '#a29db1', shadow: 0.2, muted: '#6b6578', wood: '#b9abcc', sheet: '#f7f4fb', cup: '#3a3446' }
]
const palCol = (th: Theme, i = 0) => '#' + PALETTES[i]![th.mode === 'light' ? 'light_text' : 'dark_text']
function paletteCSS(th: Theme) {
  const n = PALETTES.length
  const p = 100 / n
  const hold = p * 0.82
  let fill = ''
  PALETTES.forEach((_, i) => {
    fill += `${(i * p).toFixed(2)}%,${(i * p + hold).toFixed(2)}%{fill:${palCol(th, i)}}`
  })
  fill += `100%{fill:${palCol(th, 0)}}`
  return `@keyframes dyn_fill{${fill}}.dyn-fill{animation:dyn_fill 150s linear infinite}`
}

// ================================================================= camera
type V3 = [number, number, number]
const CAM_YAW = deg(-28)
const CAM_PITCH = deg(18)
const ca = Math.cos(CAM_YAW)
const sa = Math.sin(CAM_YAW)
const cp = Math.cos(CAM_PITCH)
const sp = Math.sin(CAM_PITCH)
const OY = 112 // card y of the floor at world z = 0
const VIEW: V3 = [-sa * cp, sp, ca * cp]
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const LIGHT: V3 = norm([-0.55, 0.9, 0.5])
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function proj([x, y, z]: V3) {
  const X = x * ca + z * sa
  const Z = -x * sa + z * ca
  return { x: X, y: OY - y * cp + Z * sp }
}
/** world x that lands on card x `cx` for a given z */
const wx = (cx: number, z = 0) => (cx - z * sa) / ca
/** world floor point that lands at card (cx, fy) */
function place(cx: number, fy: number): V3 {
  const Z = (fy - OY) / sp
  return [cx * ca - Z * sa, 0, cx * sa + Z * ca]
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
function boxFaces(b: Box, base: string, edge: string, sw = 0.6) {
  const out: string[] = []
  const axes: Array<[V3, V3, V3]> = [
    [b.u, b.v, b.w],
    [b.v, b.w, b.u],
    [b.w, b.u, b.v]
  ]
  for (const [a, e1, e2] of axes)
    for (const s of [1, -1]) {
      const n = norm(scl(a, s))
      if (dot(n, VIEW) <= 0.001) continue
      const fc = add(b.c, scl(a, s))
      const pts: V3[] = [add(add(fc, e1), e2), add(add(fc, e1), scl(e2, -1)), add(add(fc, scl(e1, -1)), scl(e2, -1)), add(add(fc, scl(e1, -1)), e2)]
      out.push(`<path d="${poly(pts)}" fill="${litColor(base, n)}" stroke="${edge}" stroke-width="${sw}" stroke-linejoin="round"/>`)
    }
  return out.join('')
}
const boxAt = (c: V3, hx: number, hy: number, hz: number): Box => ({ c, u: [hx, 0, 0], v: [0, hy, 0], w: [0, 0, hz] })

// ================================================================= SMIL
interface AnimOpts {
  dur: number
  begin?: number
  loop?: boolean
  freeze?: boolean
}
function anim(tag: 'animate' | 'animateTransform', attr: string, values: string[], o: AnimOpts, type?: string, extra = '') {
  const N = values.length - 1
  const keep: number[] = []
  for (let i = 0; i <= N; i++) if (i === 0 || i === N || values[i] !== values[i - 1] || values[i] !== values[i + 1]) keep.push(i)
  if (keep.every((i) => values[i] === values[0])) return ''
  const rep = o.loop ? ' repeatCount="indefinite"' : ''
  const fill = o.freeze ? ' fill="freeze"' : ''
  const t = type ? ` type="${type}"` : ''
  return `<${tag} attributeName="${attr}"${t} dur="${o.dur}s" begin="${o.begin ?? 0}s"${rep}${fill}${extra} keyTimes="${keep.map((i) => n2(i / N)).join(';')}" values="${keep.map((i) => values[i]).join(';')}"/>`
}
const frameTimes = (dur: number) => {
  const n = Math.round(dur * FPS)
  return Array.from({ length: n + 1 }, (_, i) => (i / n) * dur)
}
/** discrete visibility window [a, b) as fractions of the timeline */
function visWindow(a: number, b: number, o: AnimOpts) {
  const rep = o.loop ? ' repeatCount="indefinite"' : ''
  const fill = o.freeze ? ' fill="freeze"' : ''
  const kt: number[] = []
  const vs: string[] = []
  if (a > 0) {
    kt.push(0)
    vs.push('hidden')
  }
  kt.push(a)
  vs.push('visible')
  if (b < 1) {
    kt.push(b)
    vs.push('hidden')
  }
  if (kt[0] !== 0) return ''
  return `<animate attributeName="visibility" calcMode="discrete" dur="${o.dur}s" begin="${o.begin ?? 0}s"${rep}${fill} keyTimes="${kt.map((k) => n2(k)).join(';')}" values="${vs.join(';')}"/>`
}

// ================================================================= the 3D mascot rig
type Style = 'cap' | 'happy' | 'sleep' | 'heart' | 'star'
const STYLES: Style[] = ['cap', 'happy', 'sleep', 'heart', 'star']
interface Eye {
  cap: number
  happy: number
  sleep: number
  heart: number
  star: number
  w: number
  h: number
  tilt: number
  open: number
}
interface Face {
  gx: number
  gy: number
  L: Eye
  R: Eye
  mw: number
  smile: number
  mopen: number
  blush: number
}
const eye = (s: Partial<Eye>): Eye => ({ cap: 0, happy: 0, sleep: 0, heart: 0, star: 0, w: 0.2, h: 0.38, tilt: 0, open: 1, ...s })
const face = (gx: number, gy: number, L: Partial<Eye>, R: Partial<Eye> | null, mw: number, smile: number, mopen: number, blush: number): Face => ({
  gx,
  gy,
  L: eye(L),
  R: eye(R ?? { ...L, tilt: -(L.tilt ?? 0) }),
  mw,
  smile,
  mopen,
  blush
})
const FACES = {
  neutral: face(0, 0, { cap: 1 }, null, 0.13, 0.55, 0, 0.4),
  focus: face(-8, -16, { cap: 1, h: 0.32 }, null, 0.09, 0.2, 0, 0.3),
  think: face(24, 20, { cap: 1, h: 0.4 }, { cap: 1, h: 0.24 }, 0.07, -0.25, 0.14, 0.25),
  star: face(0, 4, { star: 1, w: 0.36 }, null, 0.16, 0.7, 0.8, 0.65),
  happy: face(0, 2, { happy: 1, w: 0.28 }, null, 0.17, 1, 0.5, 0.8),
  wink: face(0, 2, { cap: 1 }, { happy: 1, w: 0.26 }, 0.15, 1, 0.18, 0.9),
  love: face(0, 2, { heart: 1, w: 0.34 }, null, 0.15, 0.9, 0.35, 1),
  sad: face(-4, -14, { cap: 1, h: 0.3, tilt: -14 }, null, 0.1, -0.8, 0, 0.15),
  surprised: face(0, 4, { cap: 1, w: 0.24, h: 0.44 }, null, 0.07, 0, 0.95, 0.3),
  curious: face(-20, 16, { cap: 1, h: 0.42 }, { cap: 1, h: 0.32 }, 0.08, 0.25, 0.25, 0.4),
  sleepy: face(0, -8, { cap: 1, open: 0.35 }, null, 0.08, 0.1, 0.1, 0.4),
  yawn: face(0, 12, { sleep: 1, w: 0.26 }, null, 0.15, 0, 1, 0.45),
  asleep: face(0, -4, { sleep: 1, w: 0.26 }, null, 0.06, 0, 0.3, 0.6),
  sing: face(0, 6, { happy: 1, w: 0.28 }, null, 0.1, 0.3, 0.6, 0.8),
  proud: face(0, 4, { happy: 1, w: 0.28 }, null, 0.16, 1, 0.2, 0.85)
}
type FaceId = keyof typeof FACES
const lerpEye = (a: Eye, b: Eye, t: number): Eye => {
  const o = { ...a }
  for (const k of Object.keys(a) as Array<keyof Eye>) o[k] = lerp(a[k], b[k], t)
  return o
}
const lerpFace = (a: Face, b: Face, t: number): Face => ({
  gx: lerp(a.gx, b.gx, t),
  gy: lerp(a.gy, b.gy, t),
  L: lerpEye(a.L, b.L, t),
  R: lerpEye(a.R, b.R, t),
  mw: lerp(a.mw, b.mw, t),
  smile: lerp(a.smile, b.smile, t),
  mopen: lerp(a.mopen, b.mopen, t),
  blush: lerp(a.blush, b.blush, t)
})
interface FaceCue {
  t: number
  f: FaceId
  dur?: number
}
/** Expression track: each cue blends from whatever was on screen, with an ease-out. */
function faceTrack(cues: FaceCue[]) {
  const cs = [...cues].sort((a, b) => a.t - b.t)
  return (t: number): Face => {
    let from = FACES[cs[0]!.f]
    let to = from
    let at = -99
    let dur = 0.3
    for (const c of cs) {
      if (c.t > t) break
      from = lerpFace(from, to, easeOut((c.t - at) / dur))
      to = FACES[c.f]
      at = c.t
      dur = c.dur ?? 0.3
    }
    return lerpFace(from, to, easeOut((t - at) / dur))
  }
}

interface Puff {
  id: string
  p: V3
  r: number
  kind: 'body' | 'foot' | 'paw' | 'cup'
}
const BODY: Puff[] = [
  { id: 'back', p: [0, 0.02, -0.3], r: 0.6, kind: 'body' },
  { id: 'tl', p: [-0.27, 0.36, -0.04], r: 0.48, kind: 'body' },
  { id: 'tr', p: [0.31, 0.31, -0.04], r: 0.44, kind: 'body' },
  { id: 'l', p: [-0.5, -0.16, -0.02], r: 0.5, kind: 'body' },
  { id: 'r', p: [0.5, -0.16, -0.02], r: 0.48, kind: 'body' },
  { id: 'core', p: [0, -0.08, 0.14], r: 0.68, kind: 'body' },
  { id: 'fl', p: [-0.3, -0.84, 0.14], r: 0.21, kind: 'foot' },
  { id: 'fr', p: [0.3, -0.84, 0.14], r: 0.21, kind: 'foot' }
]
const CORE = BODY.find((b) => b.id === 'core')!
const GROUND = -1.04 // local y of the soles
const NO_LIMB_GROUND = -0.76 // bottom of the body when it has no feet
const PAW_L: V3 = [-0.68, -0.3, 0.4]
const PAW_R: V3 = [0.68, -0.3, 0.4]

interface RigPose {
  pos: V3 // world position of the body centre
  yaw: number
  pitch: number
  roll: number
  sx: number
  sy: number
  pawL: V3
  pawR: V3
  face: Face
  phones?: boolean
  limbs?: boolean
}
const U = 25 // px per body unit

function rotator(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(deg(yaw))
  const sy = Math.sin(deg(yaw))
  const cpi = Math.cos(deg(pitch))
  const spi = Math.sin(deg(pitch))
  const cr = Math.cos(deg(roll))
  const sr = Math.sin(deg(roll))
  return (v: V3): V3 => {
    // roll (z), then pitch (x: +z towards +y), then yaw (y)
    let [x, y, z] = v
    ;[x, y] = [x * cr - y * sr, x * sr + y * cr]
    ;[y, z] = [y * cpi + z * spi, -y * spi + z * cpi]
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    return [x, y, z]
  }
}

interface SphereShot {
  x: number
  y: number
  rx: number
  ry: number
  depth: number
  dark: number
}
interface FaceShot {
  depth: number
  vis: number
  eyes: Array<Record<Style, string>>
  eyeW: Array<Record<Style, number>>
  hi: Array<[string, string, number]>
  mouth: string
  mouthVis: number
  blush: [string, string]
  blushA: number
  strokeW: number
}
interface RigShot {
  spheres: Record<string, SphereShot>
  face: FaceShot
  band: { d: string; depth: number } | null
  foot: { x: number; y: number }
  head: { x: number; y: number }
  mouthPt: { x: number; y: number }
}

function capsulePts(w: number, h: number, tilt: number): Array<[number, number]> {
  const hw = w / 2
  const hh = Math.max(h, 0.012) / 2
  const r = Math.min(hw, hh)
  const pts: Array<[number, number]> = []
  const corners: Array<[number, number, number]> = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, 90],
    [-(hw - r), -(hh - r), 180],
    [hw - r, -(hh - r), 270]
  ]
  for (const [cx, cy, a0] of corners)
    for (let k = 0; k < 3; k++) {
      const a = deg(a0 + (k / 2) * 90)
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  const c = Math.cos(deg(tilt))
  const s = Math.sin(deg(tilt))
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c])
}
const heartPts = (w: number): Array<[number, number]> =>
  Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    return [(x / 34) * w, (y / 34) * w + 0.02]
  })
const starPts = (w: number): Array<[number, number]> =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2
    const r = i % 2 ? w * 0.16 : w * 0.55
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
const arcPts = (w: number, up: boolean): Array<[number, number]> =>
  Array.from({ length: 7 }, (_, i) => {
    const u = lerp(-w / 2, w / 2, i / 6)
    const k = 1 - (u / (w / 2)) ** 2
    return [u, up ? -0.02 + 0.13 * k : 0.04 - 0.12 * k]
  })

/** Pose -> projected geometry for one frame. */
function rig(p: RigPose, t: number): RigShot {
  const R = rotator(p.yaw, p.pitch, p.roll)
  const toWorld = (v: V3) => add(p.pos, scl(R(v), U))
  const groundW = toWorld([0, (p.limbs ?? true) ? GROUND : NO_LIMB_GROUND, 0])
  const g = proj([p.pos[0], Math.min(groundW[1], p.pos[1]), p.pos[2]])
  const sq = (c: { x: number; y: number }) => ({ x: g.x + (c.x - g.x) * p.sx, y: g.y + (c.y - g.y) * p.sy })
  const card = (v: V3) => sq(proj(toWorld(v)))
  const depthOf = (v: V3) => dot(toWorld(v), VIEW)

  const limbs = p.limbs ?? true
  const puffs: Puff[] = [
    ...BODY.filter((b) => limbs || b.kind !== 'foot'),
    ...(limbs
      ? ([
          { id: 'pl', p: p.pawL, r: 0.17, kind: 'paw' },
          { id: 'pr', p: p.pawR, r: 0.17, kind: 'paw' }
        ] as Puff[])
      : []),
    ...(p.phones
      ? ([
          { id: 'cl', p: [-0.86, 0.14, 0], r: 0.25, kind: 'cup' },
          { id: 'cr', p: [0.86, 0.14, 0], r: 0.25, kind: 'cup' }
        ] as Puff[])
      : [])
  ]
  const coreDepth = depthOf(CORE.p)
  const spheres: Record<string, SphereShot> = {}
  for (const s of puffs) {
    const c = card(s.p)
    const d = depthOf(s.p)
    spheres[s.id] = {
      x: c.x,
      y: c.y,
      rx: s.r * U * p.sx,
      ry: s.r * U * p.sy,
      depth: d,
      dark: s.kind === 'body' ? clamp((coreDepth - d) / (U * 0.9)) * 0.2 : 0
    }
  }

  // ---- face on the head sphere
  const life = liveliness(t, { wander: 0.45 })
  const f = p.face
  const gx = f.gx + life.dYaw * 0.5
  const gy = f.gy + life.dPitch * 0.5
  const rc = CORE.r
  const dirOf = (yaw: number, pitch: number): V3 => [
    Math.sin(deg(yaw)) * Math.cos(deg(pitch)),
    Math.sin(deg(pitch)),
    Math.cos(deg(yaw)) * Math.cos(deg(pitch))
  ]
  const surface = (yaw: number, pitch: number) => {
    const n = dirOf(yaw, pitch)
    const tu = norm([n[2], 0, -n[0]])
    const tv = cross(n, tu)
    const at = (u: number, v: number) =>
      card(add(CORE.p, scl(norm(add(n, add(scl(tu, u), scl(tv, v)))), rc * 1.005)))
    const facing = dot(norm(R(n)), VIEW)
    return { at, facing }
  }
  // relative coordinates: shorter strings, exact because we diff the rounded values
  const pathOf = (s: ReturnType<typeof surface>, pts: Array<[number, number]>, closed = true) => {
    let px = 0
    let py = 0
    return (
      pts
        .map(([u, v], i) => {
          const c = s.at(u, v)
          const x = Math.round(c.x * 10)
          const y = Math.round(c.y * 10)
          const out = i ? `l${n1((x - px) / 10)} ${n1((y - py) / 10)}` : `M${n1(x / 10)} ${n1(y / 10)}`
          px = x
          py = y
          return out
        })
        .join('') + (closed ? 'Z' : '')
    )
  }

  const SPLIT = 17
  const eyes: FaceShot['eyes'] = []
  const eyeW: FaceShot['eyeW'] = []
  const hi: FaceShot['hi'] = []
  const disc = (cu: number, cv: number, rr: number): Array<[number, number]> =>
    Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2
      return [cu + Math.cos(a) * rr, cv + Math.sin(a) * rr]
    })
  for (const side of [-1, 1]) {
    const e = side < 0 ? f.L : f.R
    const s = surface(gx + side * SPLIT, gy + 10)
    const open = e.open * (e.cap > 0.5 ? life.lid : 1)
    const rec = {} as Record<Style, string>
    const wts = {} as Record<Style, number>
    rec.cap = pathOf(s, capsulePts(e.w * 1.15, e.h * 1.15 * open, side * e.tilt))
    rec.happy = pathOf(s, arcPts(e.w * 1.15, true), false)
    rec.sleep = pathOf(s, arcPts(e.w * 1.15, false), false)
    rec.heart = pathOf(s, heartPts(e.w * 1.15))
    rec.star = pathOf(s, starPts(e.w * 1.15))
    for (const st of STYLES) wts[st] = e[st]
    // sparkle highlights: a big catch-light and a tiny one (open, heart and star eyes)
    const ew = e.w * 1.15
    const eh = e.h * 1.15 * open
    const shine = clamp(e.cap * clamp((open - 0.3) / 0.4) + e.heart * 0.9 + e.star * 0.6)
    hi.push([pathOf(s, disc(-ew * 0.2, eh * 0.2, ew * 0.24)), pathOf(s, disc(ew * 0.16, -eh * 0.18, ew * 0.11)), shine])
    eyes.push(rec)
    eyeW.push(wts)
  }
  const ms = surface(gx * 0.7, gy - 26)
  const mw = f.mw * 1.05
  const top: Array<[number, number]> = []
  const bot: Array<[number, number]> = []
  for (let i = 0; i <= 6; i++) {
    const u = lerp(-mw, mw, i / 6)
    const k = (u / mw) ** 2
    const v = f.smile * 0.06 * (k - 1)
    top.push([u, v])
    bot.push([u, v - f.mopen * 0.17 * Math.sqrt(Math.max(0, 1 - k))])
  }
  const mouth = pathOf(ms, [...top, ...bot.reverse()])
  const bl = surface(gx - 38, gy - 14)
  const br = surface(gx + 38, gy - 14)
  const blob = (s: ReturnType<typeof surface>) =>
    pathOf(
      s,
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return [Math.cos(a) * 0.19, Math.sin(a) * 0.1] as [number, number]
      })
    )
  const fcs = surface(gx, gy)
  const faceShot: FaceShot = {
    depth: coreDepth + 0.01,
    vis: clamp((fcs.facing - 0.05) / 0.2),
    eyes,
    eyeW,
    hi,
    mouth,
    mouthVis: clamp((ms.facing - 0.05) / 0.2),
    blush: [blob(bl), blob(br)],
    blushA: f.blush * clamp((fcs.facing - 0.1) / 0.3),
    strokeW: 0.075 * rc * U
  }

  let band: RigShot['band'] = null
  if (p.phones) {
    const pts: V3[] = Array.from({ length: 11 }, (_, i) => {
      const a = (i / 10) * Math.PI
      return [Math.cos(a) * 0.86, 0.22 + Math.sin(a) * 0.98, -0.06]
    })
    band = {
      d: pts.map((v, i) => {
        const c = card(v)
        return (i ? 'L' : 'M') + n1(c.x) + ' ' + n1(c.y)
      }).join(''),
      depth: depthOf([0, 1.1, -0.06])
    }
  }
  return {
    spheres,
    face: faceShot,
    band,
    foot: g,
    head: card([0, 1.0, 0]),
    mouthPt: ms.at(0, -0.05)
  }
}

/** Bake a run of rig frames into SVG (depth-ordered layer stacks switched by visibility). */
function renderRig(th: Theme, shots: RigShot[], o: AnimOpts) {
  const N = shots.length - 1
  const ids = Object.keys(shots[0]!.spheres)
  const orderOf = (s: RigShot) => {
    const items = ids.map((id) => ({ id, d: s.spheres[id]!.depth }))
    items.push({ id: '@face', d: s.face.depth })
    if (s.band) items.push({ id: '@band', d: s.band.depth })
    return items.sort((a, b) => a.d - b.d).map((i) => i.id)
  }
  // stable order: only swap neighbours when one is clearly in front (no flicker between near ties)
  const depthMap = (s: RigShot) => {
    const m: Record<string, number> = {}
    for (const id of ids) m[id] = s.spheres[id]!.depth
    m['@face'] = s.face.depth
    if (s.band) m['@band'] = s.band.depth
    return m
  }
  let prev = orderOf(shots[0]!)
  const orders = shots.map((s) => {
    const d = depthMap(s)
    const ord = [...prev]
    for (let pass = 0; pass < ord.length; pass++)
      for (let i = 0; i < ord.length - 1; i++)
        if (d[ord[i]!]! > d[ord[i + 1]!]! + 1.5) [ord[i], ord[i + 1]] = [ord[i + 1]!, ord[i]!]
    prev = ord
    return ord.join(',')
  })
  if (process.env.DEBUG) console.log('segments', new Set(orders).size)
  const segs: Array<[number, number]> = []
  let a = 0
  for (let i = 1; i <= N + 1; i++) {
    if (i === N + 1 || orders[i] !== orders[a]) {
      segs.push([a, i - 1])
      a = i
    }
  }
  const body = palCol(th)
  let out = ''
  for (const [fa, fb] of segs) {
    // values outside the run are clamped to its edges, so they collapse to nothing
    const series = <T,>(get: (s: RigShot) => T) =>
      shots.map((_, i) => get(shots[Math.min(fb, Math.max(fa, i))]!))
    let layer = ''
    for (const id of orders[fa]!.split(',')) {
      if (id === '@face') {
        const fo = series((s) => n2(s.face.vis))
        let fl = `<g opacity="${fo[0]}">${anim('animate', 'opacity', fo, o)}`
        for (const side of [0, 1]) {
          const bd = series((s) => s.face.blush[side]!)
          const ba = series((s) => n2(s.face.blushA * 0.55))
          fl += `<path d="${bd[0]}" fill="#ff7fa8" opacity="${ba[0]}" filter="url(#blur1)">${anim('animate', 'd', bd, o)}${anim('animate', 'opacity', ba, o)}</path>`
        }
        const md = series((s) => s.face.mouth)
        const mo = series((s) => n2(s.face.mouthVis))
        fl += `<path d="${md[0]}" fill="${th.mode === 'dark' ? th.mouth : mix(body, '#000000', 0.5)}" stroke="${th.ink}" stroke-width="${n1(shots[fa]!.face.strokeW * 0.7)}" stroke-linejoin="round" opacity="${mo[0]}">${anim('animate', 'd', md, o)}${anim('animate', 'opacity', mo, o)}</path>`
        for (const side of [0, 1])
          for (const st of STYLES) {
            const wts = series((s) => s.face.eyeW[side]![st])
            if (wts.every((w) => w < 0.01)) continue
            // keep the shape still while it is invisible (collapses to nothing)
            let last = ''
            const ds = series((s) => s.face.eyes[side]![st]).map((d, i) => (wts[i]! >= 0.01 ? (last = d) : last || d))
            const op = wts.map((w) => n2(w))
            const isStroke = st === 'happy' || st === 'sleep'
            const fill = st === 'heart' ? '#ff4f87' : th.ink
            const paint = isStroke
              ? `fill="none" stroke="${th.ink}" stroke-width="${n1(shots[fa]!.face.strokeW)}" stroke-linecap="round" stroke-linejoin="round"`
              : `fill="${fill}"`
            fl += `<path d="${ds[0]}" ${paint} opacity="${op[0]}">${anim('animate', 'd', ds, o)}${anim('animate', 'opacity', op, o)}</path>`
          }
        for (const side of th.mode === 'dark' ? [0, 1] : []) {
          const ho = series((s) => n2(s.face.hi[side]![2]))
          if (ho.every((v) => v === '0')) continue
          for (const k of [0, 1]) {
            const hd = series((s) => s.face.hi[side]![k] as string)
            fl += `<path d="${hd[0]}" fill="#fff" opacity="${ho[0]}">${anim('animate', 'd', hd, o)}${anim('animate', 'opacity', ho, o)}</path>`
          }
        }
        layer += fl + '</g>'
      } else if (id === '@band') {
        const bd = series((s) => s.band!.d)
        layer += `<path d="${bd[0]}" fill="none" stroke="${th.cup}" stroke-width="4.6" stroke-linecap="round">${anim('animate', 'd', bd, o)}</path><path d="${bd[0]}" fill="none" stroke="${body}" class="dyn-stroke" stroke-width="1.3" stroke-linecap="round" opacity=".9">${anim('animate', 'd', bd, o)}</path>`
      } else {
        const tr = series((s) => `${n1(s.spheres[id]!.x)} ${n1(s.spheres[id]!.y)}`)
        const sc = series((s) => `${n2(s.spheres[id]!.rx)} ${n2(s.spheres[id]!.ry)}`)
        const dk = series((s) => n2(s.spheres[id]!.dark))
        const isCup = id === 'cl' || id === 'cr'
        const base = isCup ? `fill="${th.cup}"` : `fill="${body}" class="dyn-fill"`
        layer += `<g transform="translate(${tr[0]})">${anim('animateTransform', 'transform', tr, o, 'translate')}<g transform="scale(${sc[0]})">${anim('animateTransform', 'transform', sc, o, 'scale')}<circle r="1" ${base}/><circle r="1" fill="url(#sph)"/>${
          isCup ? `<circle r=".55" fill="${body}" class="dyn-fill" opacity=".85"/><circle r=".55" fill="url(#sph)"/>` : ''
        }<circle r="1" fill="#000" opacity="${dk[0]}">${anim('animate', 'opacity', dk, o)}</circle></g></g>`
      }
    }
    const vis = segs.length > 1 ? visWindow(fa / N, (fb + 1) / N, o) : ''
    out += `<g${segs.length > 1 && fa > 0 ? ' visibility="hidden"' : ''}>${vis}${layer}</g>`
  }
  return out
}

// ================================================================= shared card pieces
function defs(extra = '') {
  return `<defs>
<radialGradient id="sph" cx=".4" cy=".36" r=".72" fx=".3" fy=".24"><stop offset="0" stop-color="#fff" stop-opacity=".72"/><stop offset=".22" stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".34"/></radialGradient>
<filter id="blur1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="glowFx" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${extra}</defs>`
}
function wrap(th: Theme, title: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${paletteCSS(th)}.dyn-stroke{animation:dyn_stroke 150s linear infinite}@keyframes dyn_stroke{${PALETTES.map((_, i) => {
    const p = 100 / PALETTES.length
    return `${(i * p).toFixed(2)}%,${(i * p + p * 0.82).toFixed(2)}%{stroke:${palCol(th, i)}}`
  }).join('')}100%{stroke:${palCol(th, 0)}}}</style>
${defs()}
${body}
</svg>
`
}

interface Phrase {
  a: number
  b: number
  title?: string
  status?: string
  live?: boolean
}
const FONT = `font-family="'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif"`
/** Caption track: label + phrases that fade/rise in on their beat, positioned at x. */
function captions(th: Theme, label: string, items: Phrase[], dur: number, opt: { begin?: number; loop?: boolean; hold?: boolean; noLabel?: boolean } = {}) {
  const f = 0.22
  const k = (t: number) => n2(clamp(t / dur))
  const lab = opt.noLabel ? '' : `<text x="0" y="38" font-size="10" font-weight="600" letter-spacing="2.2" fill="${th.muted}">${label}</text>`
  const ph = items
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
      const timing = `dur="${dur}s" begin="${opt.begin ?? 0}s"${opt.loop ? ' repeatCount="indefinite"' : ' fill="freeze"'} keyTimes="${pts.map(([t]) => k(t)).join(';')}"`
      const dot = p.live
        ? `<circle cx="5" cy="85" r="3.6" fill="#3fb950"><animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values="1;.35;1"/></circle>`
        : `<circle cx="5" cy="85" r="3.4" fill="none" stroke="${th.muted}" stroke-width="1.6"/>`
      const title = p.title ? `<text x="-1" y="66" font-size="23" font-weight="700" fill="${palCol(th)}" class="dyn-fill">${p.title}</text>` : ''
      const status = p.status ? `${dot}<text x="14" y="89" font-size="12" fill="${th.muted}">${p.status}</text>` : ''
      return `<g opacity="0"><animate attributeName="opacity" ${timing} values="${pts.map(([, v]) => v).join(';')}"/><animateTransform attributeName="transform" type="translate" ${timing} values="${pts.map(([, v]) => `0 ${v ? 0 : 4}`).join(';')}"/>${title}${status}</g>`
    })
    .join('')
  return `<g ${FONT}>${lab}${ph}</g>`
}
const groundShadow = (th: Theme, shots: RigShot[], o: AnimOpts, alpha: (i: number) => number = () => 1) => {
  const xs = shots.map((s) => `${n1(s.foot.x)} ${n1(s.foot.y + 1)}`)
  const op = shots.map((s, i) => n2(th.shadow * alpha(i) * clamp(1 - (s.foot.y - shots[i]!.foot.y) / 40)))
  return `<g transform="translate(${xs[0]})">${anim('animateTransform', 'transform', xs, o, 'translate')}<ellipse rx="${n1(U * 1.15)}" ry="${n1(U * 0.3)}" fill="#000" opacity="${op[0]}" filter="url(#soft)">${anim('animate', 'opacity', op, o)}</ellipse></g>`
}

// ---- laptop (world origin at `o`)
const LW = 74
const LD = 48
const LT = 3.4
const LL = 44
const LTH = 2.4
function laptopParts(th: Theme, o: V3, phiAt: (t: number) => number, ts: number[], ao: AnimOpts, glow: (t: number) => number) {
  const hinge = add(o, [0, LT, LD / 2])
  const lid = (phi: number): Box => {
    const dir: V3 = [0, Math.sin(phi), Math.cos(phi)]
    const back: V3 = [0, -Math.cos(phi), Math.sin(phi)]
    return { c: add(add(hinge, scl(dir, LL / 2)), scl(back, LTH / 2)), u: [LW / 2 - 0.5, 0, 0], v: scl(dir, LL / 2), w: scl(back, LTH / 2) }
  }
  // all six lid faces, morphing as it swings
  const faces = Array.from({ length: 6 }, () => ({ d: [] as string[], fill: [] as string[], op: [] as string[] }))
  for (const t of ts) {
    const b = lid(phiAt(t))
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
        faces[k]!.d.push(poly([add(add(fc, e1), e2), add(add(fc, e1), scl(e2, -1)), add(add(fc, scl(e1, -1)), scl(e2, -1)), add(add(fc, scl(e1, -1)), e2)]))
        faces[k]!.fill.push(litColor(th.metal, n))
        faces[k++]!.op.push(dot(n, VIEW) > 0.001 ? '1' : '0')
      }
  }
  const lidSvg = faces
    .filter((f) => !f.op.every((v) => v === '0'))
    .map((f) => `<path d="${f.d[0]}" fill="${f.fill[0]}" stroke="${th.metalEdge}" stroke-width=".6" stroke-linejoin="round" opacity="${f.op[0]}">${anim('animate', 'd', f.d, ao)}${anim('animate', 'fill', f.fill, ao)}${anim('animate', 'opacity', f.op, ao)}</path>`)
    .join('')
  // logo on the lid's back
  const logoD = (phi: number) => {
    const dir: V3 = [0, Math.sin(phi), Math.cos(phi)]
    const back: V3 = [0, -Math.cos(phi), Math.sin(phi)]
    const c = add(add(hinge, scl(dir, LL * 0.52)), scl(back, LTH + 0.05))
    return poly(
      BODY.filter((b) => b.kind === 'body').flatMap(() => []).concat(
        Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2
          const r = 4.2 + 0.9 * Math.cos(a * 5)
          return add(add(c, [Math.cos(a) * r, 0, 0]), scl(dir, Math.sin(a) * r * 0.85))
        })
      )
    )
  }
  const logo = `<path d="${logoD(phiAt(ts[0]!))}" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)">${anim('animate', 'd', ts.map((t) => logoD(phiAt(t))), ao)}</path>`
  const haloPts = (inf: number): V3[] => {
    const dir: V3 = [0, Math.sin(phiAt(0)), Math.cos(phiAt(0))]
    const u: V3 = [LW / 2 + inf, 0, 0]
    const top = add(hinge, scl(dir, LL + inf))
    return [add(top, u), add(top, scl(u, -1)), add(hinge, scl(u, -1)), add(hinge, u)]
  }
  const gl = ts.map((t) => n2(glow(t)))
  const halo = `<path d="${poly(haloPts(3))}" fill="${palCol(th)}" class="dyn-fill" filter="url(#softer)" opacity="${gl[0]}">${anim('animate', 'opacity', gl, ao)}</path>`
  const deck = boxFaces(boxAt(add(o, [0, LT / 2, 0]), LW / 2, LT / 2, LD / 2), th.metal, th.metalEdge)
  const shadow = `<path d="${poly([add(o, [LW / 2 + 4, 0, LD / 2 + 6]), add(o, [-LW / 2 - 4, 0, LD / 2 + 6]), add(o, [-LW / 2 - 4, 0, -LD / 2 - 4]), add(o, [LW / 2 + 4, 0, -LD / 2 - 4])])}" fill="#000" opacity="${th.shadow * 0.8}" filter="url(#softer)"/>`
  const lidTop = (phi: number) => proj(add(hinge, scl([0, Math.sin(phi), Math.cos(phi)], LL)))
  return { shadow, deck, lid: halo + lidSvg + logo, lidTop }
}

function badge(th: Theme, x: number, y: number, a: number, b: number, o: AnimOpts) {
  const k = (t: number) => n2(clamp(t / o.dur))
  const timing = `dur="${o.dur}s"${o.loop ? ' repeatCount="indefinite"' : ' fill="freeze"'}`
  return `<g transform="translate(${n1(x)} ${n1(y)})"><g opacity="0"><animate attributeName="opacity" ${timing} keyTimes="0;${k(a)};${k(a + 0.12)};${k(b - 0.3)};${k(b)};1" values="0;0;1;1;0;0"/><animateTransform attributeName="transform" type="scale" ${timing} keyTimes="0;${k(a)};${k(a + 0.18)};${k(a + 0.32)};1" values="0;0;1.3;1;1"/><circle r="8.5" fill="${palCol(th)}" class="dyn-fill" filter="url(#glowFx)"/><path d="M-3.8 0.2L-1.2 2.8L4 -2.6" fill="none" stroke="${th.mode === 'dark' ? '#15121b' : '#ffffff'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></g>`
}
/** A floating glyph that pops at `a`, drifts by (dx, dy) and fades by `b`. */
function floater(th: Theme, x: number, y: number, a: number, b: number, o: AnimOpts, content: string, dx = 0, dy = -24, size = 11, color?: string) {
  const k = (t: number) => n2(clamp(t / o.dur))
  const timing = `dur="${o.dur}s" begin="${o.begin ?? 0}s"${o.loop ? ' repeatCount="indefinite"' : ' fill="freeze"'}`
  const kt = `0;${k(a)};${k(a + 0.18)};${k(b - 0.3)};${k(b)};1`
  const paint = color ? `fill="${color}"` : `fill="${palCol(th)}" class="dyn-fill"`
  return `<g transform="translate(${n1(x)} ${n1(y)})"><g opacity="0"><animate attributeName="opacity" ${timing} keyTimes="${kt}" values="0;0;1;.9;0;0"/><animateTransform attributeName="transform" type="translate" ${timing} keyTimes="${kt}" values="0 0;0 0;${n1(dx * 0.2)} ${n1(dy * 0.2)};${n1(dx * 0.85)} ${n1(dy * 0.85)};${n1(dx)} ${n1(dy)};${n1(dx)} ${n1(dy)}"/><text ${FONT} font-size="${size}" font-weight="800" text-anchor="middle" ${paint}>${content}</text></g></g>`
}

const FACE_CAM = 26 // body yaw that faces the camera

// ================================================================= CODING
function codingCard(th: Theme) {
  const D = 12
  const ts = frameTimes(D)
  const o: AnimOpts = { dur: D, loop: true }
  const lapO: V3 = place(250, 112)
  const home: V3 = add(lapO, [34, -GROUND * U, -LD / 2 - 2])
  const typing = (t: number) => Math.max(env(t, -1, 3.3, 0.3), env(t, 4.55, 6.45, 0.2), env(t, 9.2, 13, 0.3))
  const burst = (t: number) => env(t, 4.55, 6.45, 0.2)
  const faces = faceTrack([
    { t: -1, f: 'focus' },
    { t: 3.3, f: 'think', dur: 0.4 },
    { t: 4.55, f: 'star', dur: 0.2 },
    { t: 6.5, f: 'surprised', dur: 0.15 },
    { t: 6.75, f: 'happy', dur: 0.25 },
    { t: 7.9, f: 'love', dur: 0.25 },
    { t: 8.5, f: 'wink', dur: 0.25 },
    { t: 9.2, f: 'focus', dur: 0.4 }
  ])
  const JUMP_A = 6.7
  const JUMP_B = 7.75
  const shots = ts.map((t) => {
    const ty = typing(t)
    const F = 4.25 + 1.75 * burst(t)
    const b = Math.abs(Math.sin(Math.PI * F * t))
    let pos: V3 = [...home]
    let yaw = FACE_CAM - 6 * ty
    let pitch = -8 * ty
    let roll = 0
    let sx = 1 + 0.012 * b * ty
    let sy = 1 - 0.022 * b * ty
    pos[1] -= b * 1.2 * ty
    // thinking: lean back, paw to chin
    const think = env(t, 3.3, 4.55, 0.3)
    pitch += 10 * think
    roll -= 8 * think
    // the jump: anticipation, launch, a full 3D spin at the apex, landing squash
    const pre = bump(t, JUMP_A - 0.2, JUMP_A)
    sy -= 0.12 * pre
    sx += 0.08 * pre
    if (t > JUMP_A && t < JUMP_B) {
      const u = (t - JUMP_A) / (JUMP_B - JUMP_A)
      pos[1] += 34 * Math.sin(u * Math.PI)
      yaw += 360 * smooth((u - 0.15) / 0.7)
      sy += 0.1 * Math.sin(u * Math.PI)
      sx -= 0.06 * Math.sin(u * Math.PI)
    }
    const land = bump(t, JUMP_B, JUMP_B + 0.25)
    sy -= 0.14 * land
    sx += 0.1 * land
    // paws: typing taps / cheering / chin
    const tapL = Math.max(0, Math.sin(Math.PI * F * t)) * 0.16 * ty
    const tapR = Math.max(0, Math.sin(Math.PI * F * t + Math.PI)) * 0.16 * ty
    const cheer = env(t, JUMP_A, JUMP_B + 0.8, 0.2)
    const pawL: V3 = [PAW_L[0] - 0.1 * cheer, PAW_L[1] + tapL + 1.0 * cheer, PAW_L[2] + 0.1 * ty]
    const pawR: V3 = [PAW_R[0] + 0.1 * cheer - 0.35 * think, PAW_R[1] + tapR + 1.0 * cheer + 0.32 * think, PAW_R[2] + 0.1 * ty + 0.2 * think]
    return rig({ pos, yaw, pitch, roll, sx, sy, pawL, pawR, face: faces(t) }, t)
  })
  // seamless loop: last frame == first (all motion is periodic or settled by then)
  const lap = laptopParts(th, lapO, () => deg(70), ts, o, (t) => 0.45 + 0.25 * typing(t) + 0.08 * Math.sin(t * 23) * typing(t))
  const lapGlow = lap.lid
  const top = lap.lidTop(deg(70))

  // code glyphs while typing
  const glyphs = ['{ }', '&lt;/&gt;', '=&gt;', ';', '( )', '[ ]', '&amp;&amp;', '#', '++', '//']
  const r = rng(11)
  let fl = ''
  let gi = 0
  for (let t = 0.2; t < D - 0.8; t += 0.42)
    if (typing(t) > 0.6) fl += floater(th, top.x - 30 + r() * 50, top.y - 2, t, t + 1.7, o, glyphs[gi++ % glyphs.length]!, (r() - 0.5) * 16, -26, 7 + r() * 3)
  // thinking "?" and confetti on success
  fl += floater(th, home[0] + 30, 30, 3.45, 4.5, o, '?', 4, -6, 16)
  const conf = rng(5)
  let confetti = ''
  for (let i = 0; i < 16; i++) {
    const x = 200 + conf() * 150
    const c = i % 3 === 0 ? '#ffffff' : undefined
    confetti += floater(th, x, 8 + conf() * 10, 7.0 + conf() * 0.3, 8.6 + conf() * 0.4, o, i % 2 ? '&#9632;' : '&#9679;', (conf() - 0.5) * 30, 50 + conf() * 40, 5 + conf() * 3, c)
  }
  const mascot = renderRig(th, shots, o)
  const body = `${lap.shadow}
${groundShadow(th, shots, o)}
${mascot}
${lap.deck}
${lapGlow}
${badge(th, top.x + 10, top.y - 18, 7.0, 8.4, o)}
${fl}${confetti}
<g transform="translate(18 0)">${captions(
    th,
    'BLACKSCYTHE123',
    [
      { a: 0, b: 3.3, title: 'In the zone', status: 'keys go brrrr', live: true },
      { a: 3.3, b: 4.55, title: 'Hmm&#8230;', status: 'asking the rubber duck', live: true },
      { a: 4.55, b: 6.7, title: 'Eureka!', status: 'outrunning the linter', live: true },
      { a: 6.7, b: 8.5, title: 'It compiled!', status: 'first try! (no one saw)', live: true },
      { a: 8.5, b: 9.3, title: 'Nailed it', status: 'tiny victory dance', live: true },
      { a: 9.3, b: D, title: 'Shipping it', status: 'git push, fingers crossed', live: true }
    ],
    D,
    { loop: true }
  )}</g>`
  return wrap(th, 'blackscythe123 is coding', body)
}

// ================================================================= SLEEPING
function sleepingCard(th: Theme) {
  const I = 11.2 // the story, once
  const L = 6 // then the sleep loop
  const ts = frameTimes(I)
  const o: AnimOpts = { dur: I, freeze: true }
  const DONE = 1.4
  const LID_A = 2.4
  const LID_B = 2.95
  const LAP_A = 3.1
  const LAP_B = 3.85
  const YAWN_A = 3.2
  const YAWN_B = 4.1
  const TXT_A = 4.3 // captions slip away while the bot hops past, and come back on the left
  const TXT_B = 5.4
  const HOPS = [
    [4.4, 4.85],
    [5.0, 5.45],
    [5.6, 6.05]
  ]
  const BED_A = 5.2
  const BED_B = 6.2
  const HOP_BED = [6.45, 7.05]
  const LIE_A = 7.25
  const LIE_B = 8.0
  const BLK_A = 8.1
  const BLK_B = 8.9

  const lapO: V3 = place(82, 112)
  const start: V3 = add(lapO, [12, -GROUND * U, -LD / 2 - 8])
  const bedO = place(266, 104)
  const bedX = bedO[0]
  const bz = bedO[2]
  const BED = { len: 112, dep: 58, frameH: 9, matH: 8 }
  const MAT_TOP = BED.frameH + BED.matH
  const stops: V3[] = [start, add(place(150, 116), [0, start[1], 0]), add(place(188, 118), [0, start[1], 0]), add(place(214, 120), [0, start[1], 0])]
  const lieC: V3 = [bedX - 16, MAT_TOP + 0.5 * U, bz - 2]
  const sitOnBed: V3 = [bedX - 4, MAT_TOP - GROUND * U, bz + 4]

  const faces = faceTrack([
    { t: -1, f: 'focus' },
    { t: DONE, f: 'proud', dur: 0.25 },
    { t: 2.3, f: 'sleepy', dur: 0.5 },
    { t: YAWN_A, f: 'yawn', dur: 0.35 },
    { t: YAWN_B, f: 'sleepy', dur: 0.35 },
    { t: BED_A, f: 'surprised', dur: 0.15 },
    { t: BED_A + 0.45, f: 'love', dur: 0.3 },
    { t: 6.3, f: 'happy', dur: 0.3 },
    { t: LIE_A, f: 'sleepy', dur: 0.4 },
    { t: LIE_B - 0.2, f: 'asleep', dur: 0.5 }
  ])
  const typingS = (t: number) => env(t, -1, DONE + 0.05, 0.25)
  const shots = ts.map((t) => {
    let pos: V3 = [...start]
    let yaw = FACE_CAM
    let pitch = 0
    let roll = 0
    let sx = 1
    let sy = 1
    const b = Math.abs(Math.sin(Math.PI * 4.25 * t))
    pos[1] -= b * 1.2 * typingS(t)
    pitch -= 8 * typingS(t)
    pos[1] += 8 * bump(t, DONE, DONE + 0.4)
    pitch -= 14 * env(t, LID_A - 0.1, LID_B + 0.1, 0.2) // leans over to shut the lid
    const yawn = env(t, YAWN_A, YAWN_B, 0.3)
    sy += 0.14 * yawn
    sx -= 0.08 * yawn
    pitch += 12 * yawn
    // hops across the card, turning towards where it's going
    const allHops = [...HOPS, HOP_BED]
    allHops.forEach(([a, bb], i) => {
      const from = i < HOPS.length ? stops[i]! : stops[stops.length - 1]!
      const to = i < HOPS.length ? stops[i + 1]! : sitOnBed
      if (t >= a) {
        const u = clamp((t - a) / (bb - a))
        pos = [lerp(from[0], to[0], smooth(u)), lerp(from[1], to[1], u) + (i < HOPS.length ? 12 : 22) * Math.sin(u * Math.PI), lerp(from[2], to[2], smooth(u))]
        sy += 0.1 * Math.sin(u * Math.PI)
        sx -= 0.06 * Math.sin(u * Math.PI)
      }
      const pre = bump(t, a - 0.16, a)
      const land = bump(t, bb, bb + 0.18)
      sy -= 0.09 * pre + 0.12 * land
      sx += 0.06 * pre + 0.09 * land
    })
    yaw += 34 * env(t, 4.3, 6.1, 0.3) // faces right while walking
    yaw -= 20 * env(t, BED_A, 6.3, 0.25) // glances back at the bed
    // lie back: body pivots onto the pillow, face up, head to the headboard
    if (t > LIE_A) {
      const u = smooth((t - LIE_A) / (LIE_B - LIE_A))
      pos = [lerp(sitOnBed[0], lieC[0], u), lerp(sitOnBed[1], lieC[1], u) + 6 * Math.sin(u * Math.PI), lerp(sitOnBed[2], lieC[2], u)]
      yaw = lerp(FACE_CAM, 72, u)
      pitch = lerp(0, 58, u)
    }
    const sink = bump(t, LIE_B - 0.05, LIE_B + 0.35)
    sy -= 0.06 * sink
    const tap = Math.max(0, Math.sin(Math.PI * 4.25 * t)) * 0.16 * typingS(t)
    const stretch = yawn
    const pawL: V3 = [PAW_L[0] - 0.2 * stretch, PAW_L[1] + tap + 1.1 * stretch, PAW_L[2]]
    const pawR: V3 = [PAW_R[0] + 0.2 * stretch, PAW_R[1] + Math.max(0, Math.sin(Math.PI * 4.25 * t + Math.PI)) * 0.16 * typingS(t) + 1.1 * stretch, PAW_R[2]]
    return rig({ pos, yaw, pitch, roll, sx, sy, pawL, pawR, face: faces(t) }, t)
  })
  const mascot = renderRig(th, shots, o)
  const lastShot = shots[shots.length - 1]!
  const bodyC = { x: lastShot.spheres.core!.x, y: lastShot.spheres.core!.y }

  // laptop: lid shuts, then slides off to the left
  const phiAt = (t: number) => lerp(deg(70), Math.PI - 0.03, easeIn(clamp((t - LID_A) / (LID_B - LID_A))))
  const lap = laptopParts(th, lapO, phiAt, ts, o, (t) => 0.55 * (1 - smooth((t - LID_A) / 0.4)))
  const lapSlide = anim('animateTransform', 'transform', ts.map((t) => `${n1(-170 * easeIn(clamp((t - LAP_A) / (LAP_B - LAP_A))))} 0`), o, 'translate')
  const laptop = `<g>${lapSlide}${lap.shadow}${lap.deck}${lap.lid}</g>`

  // bed, slides in from the right
  const wood = th.wood
  const woodE = mix(wood, '#000000', 0.3)
  const sheet = th.sheet
  const sheetE = mix(sheet, '#000000', 0.18)
  const hl = BED.len / 2
  const hd = BED.dep / 2
  const legs = [-1, 1].flatMap((ax) => [-1, 1].map((az) => boxFaces(boxAt([bedX + ax * (hl - 3), 1.5, bz + az * (hd - 3)], 2, 1.5, 2), wood, woodE))).join('')
  const bed = `<path d="${poly([[bedX + hl + 6, 0, bz + hd + 6], [bedX - hl - 6, 0, bz + hd + 6], [bedX - hl - 6, 0, bz - hd - 4], [bedX + hl + 6, 0, bz - hd - 4]])}" fill="#000" opacity="${th.shadow * 0.9}" filter="url(#softer)"/>
${boxFaces(boxAt([bedX - hl - 2, 18, bz], 2.5, 18, hd + 1), wood, woodE)}${legs}${boxFaces(boxAt([bedX, BED.frameH / 2 + 1.5, bz], hl, BED.frameH / 2 - 1.5, hd), wood, woodE)}${boxFaces(boxAt([bedX, BED.frameH + BED.matH / 2, bz], hl - 1, BED.matH / 2, hd - 1.5), sheet, sheetE)}${boxFaces(boxAt([bedX - hl + 13, MAT_TOP + 3.2, bz], 8, 2.8, 16), sheet, sheet, 5)}${boxFaces(boxAt([bedX + hl + 1.5, 10, bz], 1.8, 10, hd + 1), wood, woodE)}`
  const bedSlide = anim('animateTransform', 'transform', ts.map((t) => `${n1(170 * (1 - easeOut(clamp((t - BED_A) / (BED_B - BED_A)))))} 0`), o, 'translate')

  // quilt: a curved surface with a hump over the body, built back -> front, unrolling to the chin
  const footX = bedX + hl + 0.5
  const half = hd + 1
  const humpC = lieC[0] + 18
  const hump = (x: number) => 15 * Math.exp(-(((x - humpC) / 17) ** 2))
  const qh = (x: number, z: number) => MAT_TOP + 1.2 + hump(x) * (1 - 0.75 * (z / half) ** 2)
  const reach = (t: number) => lerp(footX - 2, lieC[0] + 6, easeOut(clamp((t - BLK_A) / (BLK_B - BLK_A))))
  const NX = 14
  const ZS = [-half, -half / 2, 0, half / 2, half]
  const strip = (x0: number, x1: number, z0: number, z1: number, lift = 0) => {
    const xs = Array.from({ length: NX + 1 }, (_, i) => lerp(x0, x1, i / NX))
    return poly([...xs.map((x) => [x, qh(x, z0) + lift, bz + z0] as V3), ...xs.map((x) => [x, qh(x, z1) + lift, bz + z1] as V3).reverse()])
  }
  const qs = ZS.slice(0, -1)
    .map((z0, i) => {
      const ds = ts.map((t) => strip(reach(t), footX, z0, ZS[i + 1]!))
      return `<path d="${ds[0]}" fill="${palCol(th)}" class="dyn-fill">${anim('animate', 'd', ds, o)}</path><path d="${ds[0]}" fill="#000" opacity="${[0.3, 0.12, 0.04, 0.22][i]}">${anim('animate', 'd', ds, o)}</path>`
    })
    .join('')
  const drapeD = ts.map((t) => {
    const xs = Array.from({ length: NX + 1 }, (_, i) => lerp(reach(t), footX, i / NX))
    return poly([...xs.map((x) => [x, qh(x, half), bz + half] as V3), ...[...xs].reverse().map((x) => [x, BED.frameH + 1, bz + half + 0.6] as V3)])
  })
  const foldD = ts.map((t) => ZS.slice(0, -1).map((z0, i) => strip(reach(t) - 0.5, reach(t) + 5.5, z0, ZS[i + 1]!, 0.7)).join(''))
  const qBase = proj([humpC, MAT_TOP, bz])
  const quilt = `<g opacity="0"><set attributeName="opacity" to="1" begin="${BLK_A}s" fill="freeze"/><g transform="translate(${n1(qBase.x)} ${n1(qBase.y)})"><g><animateTransform attributeName="transform" type="scale" begin="${I}s" dur="${L / 2}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values="1 1;1 1.05;1 1"/><g transform="translate(${n1(-qBase.x)} ${n1(-qBase.y)})">
<path d="${drapeD[0]}" fill="${palCol(th)}" class="dyn-fill">${anim('animate', 'd', drapeD, o)}</path><path d="${drapeD[0]}" fill="#000" opacity=".38">${anim('animate', 'd', drapeD, o)}</path>${qs}<path d="${foldD[0]}" fill="${sheet}" stroke="${sheetE}" stroke-width=".6" stroke-linejoin="round">${anim('animate', 'd', foldD, o)}</path></g></g></g></g>`

  // asleep: breathing (scaled about the body), Zzz, and a dream bubble — dreaming in code
  const breath = `<animateTransform attributeName="transform" type="scale" begin="${I}s" dur="${L / 2}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values="1 1;1.03 1.04;1 1"/>`
  const zl: AnimOpts = { dur: L, begin: I, loop: true }
  const zs = [0, 1, 2].map((i) => floater(th, lastShot.head.x + 2 + i * 3, lastShot.head.y - 8, i * 1.4, i * 1.4 + 2.6, zl, 'z', 12, -26, 11 + i * 3)).join('')
  const db = { x: lastShot.head.x - 70, y: 26 }
  const dream = `<g opacity="0"><animate attributeName="opacity" begin="${I - 0.6}s" dur=".8s" fill="freeze" values="0;1"/>
<circle cx="${n1(lastShot.head.x - 10)}" cy="${n1(lastShot.head.y - 16)}" r="2.2" fill="${th.sheet}" opacity=".85"/>
<circle cx="${n1(lastShot.head.x - 20)}" cy="${n1(lastShot.head.y - 26)}" r="3.2" fill="${th.sheet}" opacity=".85"/>
<g transform="translate(${n1(db.x)} ${n1(db.y)})"><animateTransform attributeName="transform" type="translate" begin="${I}s" dur="3s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values="${n1(db.x)} ${n1(db.y)};${n1(db.x)} ${n1(db.y - 2)};${n1(db.x)} ${n1(db.y)}"/><g transform="scale(1.5)">
<path d="M-4 6 C-12 6 -12 -6 -3 -6 C-2 -13 10 -14 13 -8 C17 -14 30 -12 30 -5 C38 -5 38 7 29 7 C27 13 14 13 12 9 C8 13 -2 12 -4 6Z" fill="${th.sheet}" opacity=".92"/>
<clipPath id="dreamClip"><rect x="-2" y="-8" width="32" height="15"/></clipPath>
<g clip-path="url(#dreamClip)"><g><animateTransform attributeName="transform" type="translate" begin="${I}s" dur="4s" repeatCount="indefinite" values="0 0;0 -12"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${[0, 4, 4, 0, 8, 4][i]}" y="${-5 + i * 4}" width="${[14, 18, 10, 20, 12, 16][i]}" height="1.8" rx=".9" fill="${palCol(th)}" class="dyn-fill" opacity="${i % 2 ? 0.6 : 1}"/>`).join('')}
</g></g></g></g></g>`

  const body = `<g transform="translate(170 0)">${bedSlide}${bed}</g>
${groundShadow(th, shots, o, (i) => 1 - smooth((ts[i]! - HOP_BED[0]!) / 0.3))}
<g transform="translate(${n1(bodyC.x)} ${n1(bodyC.y)})"><g>${breath}<g transform="translate(${n1(-bodyC.x)} ${n1(-bodyC.y)})">${mascot}</g></g></g>
${quilt}
${laptop}
${badge(th, lap.lidTop(deg(70)).x + 8, lap.lidTop(deg(70)).y - 16, DONE, 2.4, o)}
${zs}${dream}
<g transform="translate(196 0)">${anim('animateTransform', 'transform', ts.map((t) => `${n1(lerp(196, 18, smooth((t - TXT_A) / (TXT_B - TXT_A))))} 0`), o, 'translate')}${captions(
    th,
    'BLACKSCYTHE123',
    [
      { a: 0, b: DONE, title: 'Last commit', status: 'one more line, promise', live: true },
      { a: DONE, b: LID_A, title: 'Shipped it!', status: 'tests green, brain fried', live: true },
      { a: LID_A, b: TXT_A, title: 'Logging off', status: 'laptop says goodnight' },
      { a: 5.7, b: BED_B + 0.3, title: 'Bedtime!', status: 'a wild bed appeared' },
      { a: BED_B + 0.3, b: BLK_A, title: 'Tucking in', status: 'fluffing the pillow' },
      { a: BLK_A, b: I, title: 'Fast asleep' }
    ],
    I,
    { hold: true }
  )}${captions(
    th,
    '',
    [
      { a: 0, b: 6, status: 'dreaming in code' },
      { a: 6, b: 12, status: 'zzz&#8230; merge conflicts&#8230;' },
      { a: 12, b: 18, status: 'do not disturb (srsly)' }
    ],
    18,
    { begin: BLK_A + 0.2, loop: true, noLabel: true }
  )}</g>`
  return wrap(th, 'blackscythe123 is sleeping', body)
}

// ================================================================= SPOTIFY OFFLINE
/** Cuter faces for the spotify card: rounder, bigger eyes, more blush. */
const SPOT_FACES: Record<string, Face> = {
  listen: face(-16, 14, { cap: 1, w: 0.26, h: 0.42 }, { cap: 1, w: 0.26, h: 0.36 }, 0.07, 0.15, 0.3, 0.6),
  sad: face(-4, -12, { cap: 1, w: 0.25, h: 0.36, tilt: -12 }, null, 0.09, -0.85, 0, 0.35),
  pout: face(0, -6, { cap: 1, w: 0.26, h: 0.4 }, null, 0.06, -0.3, 0.25, 0.5),
  idea: face(0, 6, { star: 1, w: 0.42 }, null, 0.12, 0.6, 0.85, 0.75),
  sing: face(0, 8, { happy: 1, w: 0.32 }, null, 0.1, 0.35, 0.65, 0.95),
  love: face(0, 4, { heart: 1, w: 0.4 }, null, 0.14, 0.95, 0.4, 1),
  wink: face(0, 4, { cap: 1, w: 0.27, h: 0.44 }, { happy: 1, w: 0.3 }, 0.13, 1, 0.2, 1),
  content: face(0, 2, { cap: 1, w: 0.26, h: 0.44 }, null, 0.11, 0.8, 0.12, 0.7)
}
function spotTrack(cues: Array<{ t: number; f: string; dur?: number }>) {
  const cs = [...cues].sort((a, b) => a.t - b.t)
  return (t: number): Face => {
    let from = SPOT_FACES[cs[0]!.f]!
    let to = from
    let at = -99
    let dur = 0.3
    for (const c of cs) {
      if (c.t > t) break
      from = lerpFace(from, to, easeOut((c.t - at) / dur))
      to = SPOT_FACES[c.f]!
      at = c.t
      dur = c.dur ?? 0.3
    }
    return lerpFace(from, to, easeOut((t - at) / dur))
  }
}

function spotifyCard(th: Theme) {
  const D = 14
  const ts = frameTimes(D)
  const o: AnimOpts = { dur: D, loop: true }
  const lift = -NO_LIMB_GROUND * U
  const right: V3 = add(place(288, 116), [0, lift, 0])
  const left: V3 = add(place(104, 116), [0, lift, 0])
  const WALK_A = 4.4
  const WALK_B = 6.0
  const SPIN_A = 8.6
  const SPIN_B = 9.7
  const BACK_A = 11.6
  const BACK_B = 12.8
  const faces = spotTrack([
    { t: -1, f: 'content' },
    { t: 0.4, f: 'listen', dur: 0.35 },
    { t: 2.2, f: 'sad', dur: 0.45 },
    { t: 3.1, f: 'pout', dur: 0.3 },
    { t: 3.6, f: 'idea', dur: 0.15 },
    { t: 4.4, f: 'sing', dur: 0.3 },
    { t: SPIN_A, f: 'love', dur: 0.2 },
    { t: 10.0, f: 'wink', dur: 0.25 },
    { t: 11.3, f: 'sing', dur: 0.3 },
    { t: 13.0, f: 'content', dur: 0.5 }
  ])
  const hop = (t: number, a: number, b: number, from: V3, to: V3, n: number) => {
    const u = clamp((t - a) / (b - a))
    const h = Math.abs(Math.sin(u * Math.PI * n))
    return { pos: [lerp(from[0], to[0], u), from[1] + 8 * h, lerp(from[2], to[2], u)] as V3, h, moving: t > a && t < b }
  }
  const shots = ts.map((t) => {
    let pos: V3 = [...right]
    let yaw = FACE_CAM
    let pitch = 0
    let roll = 0
    let sx = 1
    let sy = 1
    // idle breathing, always
    const breathe = Math.sin(t * Math.PI * 2 * 0.5)
    sy += 0.015 * breathe
    sx -= 0.01 * breathe
    // listening: head tilts side to side, straining to hear
    const listen = env(t, 0.4, 2.2, 0.3)
    roll += 13 * listen * Math.sin(t * 3.1)
    yaw -= 10 * listen
    // sad: deflates a little
    const sad = env(t, 2.2, 3.6, 0.35)
    pitch -= 12 * sad
    sy -= 0.09 * sad
    sx += 0.06 * sad
    // idea: pops up
    if (t > 3.6 && t < 4.1) {
      const u = (t - 3.6) / 0.5
      pos[1] += 12 * Math.sin(u * Math.PI)
      sy += 0.08 * Math.sin(u * Math.PI)
    }
    // hops left
    if (t >= WALK_A) {
      const w = hop(t, WALK_A, WALK_B, right, left, 4)
      pos = w.pos
      if (w.moving) {
        yaw -= 38
        sy += 0.07 * w.h
        sx -= 0.04 * w.h
      }
    }
    // sings and sways on the left, bouncing to the beat
    const sway = env(t, WALK_B, SPIN_A, 0.3)
    roll += 11 * Math.sin(t * Math.PI * 2) * sway
    const beat = Math.abs(Math.sin(t * Math.PI * 2))
    pos[1] += 4 * beat * sway
    sy += 0.04 * (1 - beat) * sway
    // jump + full 3D spin
    const pre = bump(t, SPIN_A - 0.2, SPIN_A)
    sy -= 0.14 * pre
    sx += 0.1 * pre
    if (t > SPIN_A && t < SPIN_B) {
      const u = (t - SPIN_A) / (SPIN_B - SPIN_A)
      pos[1] += 32 * Math.sin(u * Math.PI)
      yaw -= 360 * smooth((u - 0.12) / 0.75)
      sy += 0.1 * Math.sin(u * Math.PI)
      sx -= 0.07 * Math.sin(u * Math.PI)
    }
    const land = bump(t, SPIN_B, SPIN_B + 0.25)
    sy -= 0.16 * land
    sx += 0.12 * land
    // wink: a shy little wiggle
    const shy = env(t, 10, 11.4, 0.25)
    roll += 7 * Math.sin(t * 12) * shy
    yaw += 8 * shy
    // hops home, humming
    if (t >= BACK_A) {
      const w = hop(t, BACK_A, BACK_B, left, right, 4)
      pos = w.pos
      if (w.moving) {
        yaw += 38
        sy += 0.07 * w.h
        sx -= 0.04 * w.h
      }
    }
    const f = faces(t)
    const singing = env(t, WALK_A, SPIN_A, 0.3) + env(t, 11.3, 13, 0.3)
    if (singing > 0.05) f.mopen = clamp(f.mopen * (0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI * 3))))
    return rig({ pos, yaw, pitch, roll, sx, sy, pawL: PAW_L, pawR: PAW_R, face: f, phones: true, limbs: false }, t)
  })
  const mascot = renderRig(th, shots, o)

  // props that carry each mood
  const at = (t: number) => shots[Math.round((t / D) * (shots.length - 1))]!
  let fx = ''
  fx += floater(th, at(0.8).head.x + 24, at(0.8).head.y + 2, 0.8, 2.2, o, '?', 3, -6, 15)
  fx += floater(th, at(1.4).head.x - 22, at(1.4).head.y + 6, 1.4, 2.2, o, '?', -3, -6, 11)
  fx += floater(th, at(2.5).head.x + 22, at(2.5).head.y + 14, 2.5, 3.6, o, '&#128167;', 2, 8, 10, '#7cc7ff')
  fx += floater(th, at(3.7).head.x + 2, at(3.7).head.y - 6, 3.7, 4.5, o, '&#128161;', 0, -8, 15, '#ffd23f')
  const notes = ['&#9834;', '&#9835;', '&#9833;', '&#9836;']
  const nr = rng(3)
  let k = 0
  for (let t = WALK_A + 0.2; t < SPIN_A - 0.4; t += 0.36) {
    const s = at(t)
    fx += floater(th, s.mouthPt.x + 8, s.mouthPt.y - 8, t, t + 1.7, o, notes[k++ % 4]!, 10 + nr() * 18, -30 - nr() * 10, 11 + nr() * 5)
  }
  for (let t = 11.5; t < 12.9; t += 0.45) {
    const s = at(t)
    fx += floater(th, s.mouthPt.x - 6, s.mouthPt.y - 8, t, t + 1.4, o, notes[k++ % 4]!, -10 - nr() * 10, -26, 10 + nr() * 3)
  }
  const hr = rng(9)
  for (let i = 0; i < 8; i++) {
    const s = at(SPIN_A + 0.5)
    fx += floater(th, s.head.x + (hr() - 0.5) * 34, s.head.y + 8, SPIN_A + 0.4 + i * 0.08, SPIN_A + 1.8 + i * 0.08, o, '&#10084;', (hr() - 0.5) * 54, -20 - hr() * 18, 9 + hr() * 5, '#ff5c93')
  }
  fx += floater(th, at(10.2).head.x + 26, at(10.2).head.y + 4, 10.2, 11.4, o, '&#10022;', 4, -4, 12)
  fx += floater(th, at(10.5).head.x + 34, at(10.5).head.y + 16, 10.5, 11.4, o, '&#10022;', 3, -3, 8)

  // captions slide right while the bot sings on the left, then come home
  // the captions hide while the bot hops past, and move while hidden
  const tx = ts.map((t) => n1(lerp(18, 192, smooth((t - 4.7) / 0.8) * (1 - smooth((t - 11.9) / 0.6)))))
  const body = `${groundShadow(th, shots, o)}
${mascot}
${fx}
<g transform="translate(18 0)">${anim('animateTransform', 'transform', tx.map((x) => `${x} 0`), o, 'translate')}${captions(
    th,
    'SPOTIFY &#183; OFFLINE',
    [
      { a: 0, b: 2.2, title: 'Hello? Music?', status: 'my headphones hear nothing' },
      { a: 2.2, b: 3.6, title: 'No tunes&#8230;', status: 'Spotify went quiet on me' },
      { a: 3.6, b: 4.4, title: 'Oh! Idea!', status: 'who needs wifi anyway' },
      { a: WALK_B, b: SPIN_A, title: 'La la la &#9834;', status: 'singing my own playlist' },
      { a: SPIN_A, b: 10, title: 'Encore!', status: 'the crowd goes wild' },
      { a: 10, b: BACK_A, title: 'Shh!', status: 'I&#8217;m a little off-key ;)' },
      { a: BACK_B, b: D, title: 'Be right back', status: 'finding the aux cord' }
    ],
    D,
    { loop: true }
  )}</g>`
  return wrap(th, 'Spotify offline', body)
}

/** GitHub serves these through <img>: one malformed tag and nothing renders. */
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
const only = process.env.ONLY
for (const th of THEMES) {
  for (const [name, make] of [
    ['coding', codingCard],
    ['sleeping', sleepingCard],
    ['spotify-offline', spotifyCard]
  ] as const) {
    if (only && !name.startsWith(only)) continue
    if (process.env.MODE && th.mode !== process.env.MODE) continue
    const svg = make(th)
    assertWellFormed(name, svg)
    const file = `${name}-${th.mode}.svg`
    fs.writeFileSync(path.join(OUT, file), svg)
    console.log(file.padEnd(28), (Buffer.byteLength(svg) / 1024).toFixed(1) + ' KB')
  }
}
