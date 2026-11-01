/**
 * The smallest complete use of the Bloub engine. Start here, then read AGENTS.md.
 *
 *   npx tsx studio/hello.ts
 *
 * Writes:
 *   output/hello-still.svg     one frozen frame, rendered exactly like BloubBot.vue does
 *   output/hello-animated.svg  a looping animation (idle -> wink -> wide -> idle) that plays
 *                              inside a plain <img>, e.g. a GitHub README (SMIL, no JS)
 */
import fs from 'node:fs'
import { BotEngine, type BotFrame } from '../src/bot/engine'
import { SHAPE_BY_ID, COLOR_BY_ID } from '../src/bot/skins'
import { EXPRESSION_BY_ID } from '../src/bot/expressions'
import { RAYON, DEMI_VIEWBOX } from '../src/bot/repere'
import type { StateId } from '../src/bot/states'

const VB = DEMI_VIEWBOX // the engine draws in [-158, 158] x [-158, 158], y pointing down
const INK = COLOR_BY_ID.get('violet')!.hex
const PAPER = '#ffffff'
fs.mkdirSync('output', { recursive: true })

// ---------------------------------------------------------------- 1. a still frame
// Same layers as src/components/BloubBot.vue: the eyes are HOLES in a mask, not shapes on top.
function stillSvg(f: BotFrame) {
  const eyes = f.eyes.map((e) => `<path d="${e.d}" transform="${e.matrix}" opacity="${e.alpha}" fill="#000"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="${-VB} ${-VB} ${VB * 2} ${VB * 2}">
<defs><mask id="m" maskUnits="userSpaceOnUse" x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}">
<path d="${f.bodyPath}" fill="#fff"/>${eyes}</mask></defs>
<path d="${f.bodyPath}" fill="${PAPER}"/>
<g mask="url(#m)"><rect x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}" fill="${INK}"/></g>
</svg>`
}

const still = new BotEngine(RAYON, 'idle', SHAPE_BY_ID.get('nuage')!.radii, EXPRESSION_BY_ID.get('heureux')!)
fs.writeFileSync('output/hello-still.svg', stillSvg(still.sample(1)))

// ---------------------------------------------------------------- 2. an animated SVG
// SVG can't animate a `transform="matrix(...)"` with SMIL, so each eye capsule is turned into
// a polygon in final coordinates. Body and eye polygons keep the same point count every
// frame, which is exactly what <animate attributeName="d"> needs to morph.
function eyePolygon(e: BotFrame['eyes'][number]) {
  const n = e.d.match(/-?\d+\.?\d*/g)!.map(Number)
  const hw = -n[0]!
  const r = n[2]!
  const hh = r - n[1]!
  const [a, b, c, d, ex, ey] = e.matrix.match(/-?\d+\.?\d*/g)!.map(Number) as [number, number, number, number, number, number]
  const pts: string[] = []
  const corners: Array<[number, number, number]> = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, 90],
    [-(hw - r), -(hh - r), 180],
    [hw - r, -(hh - r), 270]
  ]
  for (const [cx, cy, a0] of corners)
    for (let k = 0; k < 4; k++) {
      const ang = ((a0 + (k / 3) * 90) * Math.PI) / 180
      const x = cx + Math.cos(ang) * r
      const y = cy + Math.sin(ang) * r
      pts.push(`${(a * x + c * y + ex).toFixed(1)} ${(b * x + d * y + ey).toFixed(1)}`)
    }
  return 'M' + pts.join('L') + 'Z'
}

// a montage, in seconds: which state starts when
const MONTAGE: Array<[number, StateId]> = [
  [0, 'idle'],
  [2, 'wink'],
  [3.6, 'wide'],
  [5.4, 'idle']
]
const DUR = 7.2
const FPS = 15 // enough for blinks and morphs; every extra frame costs a full body outline
const eng = new BotEngine(RAYON, 'idle', SHAPE_BY_ID.get('nuage')!.radii, EXPRESSION_BY_ID.get('heureux')!)
const body: string[] = []
const eye0: string[] = []
const eye1: string[] = []
const N = Math.round(DUR * FPS)
let next = 1
for (let i = 0; i <= N; i++) {
  const t = (i / N) * DUR
  // setters are timestamped: call them at their own date, in order, before sampling
  while (next < MONTAGE.length && MONTAGE[next]![0] <= t) {
    eng.setState(MONTAGE[next]![1], MONTAGE[next]![0])
    next++
  }
  const f = eng.sample(t)
  body.push(f.bodyPath)
  // an eye can be missing (state without a face): keep the last one so the point count holds
  eye0.push(f.eyes[0] ? eyePolygon(f.eyes[0]) : eye0[eye0.length - 1] ?? '')
  eye1.push(f.eyes[1] ? eyePolygon(f.eyes[1]) : eye1[eye1.length - 1] ?? '')
}
const anim = (values: string[]) =>
  `<animate attributeName="d" dur="${DUR}s" repeatCount="indefinite" calcMode="linear" values="${values.join(';')}"/>`
fs.writeFileSync(
  'output/hello-animated.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="${-VB} ${-VB} ${VB * 2} ${VB * 2}">
<defs>
<!-- the animated outline is written ONCE (no fill, so each <use> can paint it) and reused twice -->
<path id="body" d="${body[0]}">${anim(body)}</path>
<mask id="m" maskUnits="userSpaceOnUse" x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}">
<use href="#body" fill="#fff"/>
<path d="${eye0[0]}" fill="#000">${anim(eye0)}</path>
<path d="${eye1[0]}" fill="#000">${anim(eye1)}</path>
</mask></defs>
<use href="#body" fill="${PAPER}"/>
<g mask="url(#m)"><rect x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}" fill="${INK}"/></g>
</svg>`
)
console.log('wrote output/hello-still.svg and output/hello-animated.svg')
