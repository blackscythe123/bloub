import { describe, expect, it } from 'vitest'
import { BotEngine } from './engine'
import { EXPRESSIONS, EXPRESSION_BY_ID, blendExpression, type ExpressionId } from './expressions'
import { SHAPES, SHAPE_BY_ID } from './skins'
import { STATE_BY_ID, type StateId } from './states'

/**
 * Bouche et styles d'yeux (`traits.ts`) : ce qu'ils ajoutent, et surtout ce qu'ils ne
 * touchent pas — les seize expressions et les quinze etats d'origine n'en portent pas et
 * doivent rendre exactement ce qu'ils rendaient.
 */

const R = 100
const cercle = () => SHAPE_BY_ID.get('cercle')!.radii
const expr = (id: ExpressionId) => EXPRESSION_BY_ID.get(id)!

const NOUVELLES: ExpressionId[] = ['joyeux', 'etoile', 'clin', 'chante', 'endormi', 'concentre']
const NOUVEAUX: StateId[] = ['typing', 'cheer', 'sing', 'doze']

/** Contour du corps, lu sur le `bodyPath` (3e paire de chaque `C`). */
function contour(d: string) {
  const pts: Array<{ x: number; y: number }> = []
  for (const seg of d.slice(1).split('C')) {
    const n = seg.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    if (n.length >= 6) pts.push({ x: n[4]!, y: n[5]! })
    else if (n.length === 2) pts.push({ x: n[0]!, y: n[1]! })
  }
  return pts
}

/** Distance signee au contour : positive = dedans. */
function marge(poly: Array<{ x: number; y: number }>, x: number, y: number) {
  let dedans = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans
  }
  const d = Math.min(...poly.map((p) => Math.hypot(p.x - x, p.y - y)))
  return dedans ? d : -d
}

/** Tous les points d'un chemin (extremites ET points de controle : conservateur). */
const points = (d: string) => {
  const n = d.match(/-?\d+\.?\d*/g)!.map(Number)
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! })
  return out
}

describe('blendExpression et les extras du visage', () => {
  it('interpole bouche et styles d yeux lineairement', () => {
    const a = expr('joyeux')
    const b = expr('etoile')
    const m = blendExpression(a, b, 0.5)
    expect(m.face!.mouth!.w).toBeCloseTo((a.face!.mouth!.w + b.face!.mouth!.w) / 2, 6)
    expect(m.face!.mouth!.open).toBeCloseTo((a.face!.mouth!.open + b.face!.mouth!.open) / 2, 6)
    expect(m.face!.mouth!.smile).toBeCloseTo((a.face!.mouth!.smile + b.face!.mouth!.smile) / 2, 6)
    expect(m.face!.happy).toEqual([0.5, 0.5])
    expect(m.face!.star).toEqual([0.5, 0.5])
  })

  it('fait pousser ce qui manque depuis zero', () => {
    const vers = expr('joyeux')
    const m = blendExpression(expr('neutre'), vers, 0.25)
    expect(m.face!.mouth!.w).toBeCloseTo(vers.face!.mouth!.w * 0.25, 6)
    expect(m.face!.happy).toEqual([0.25, 0.25])
    expect(m.face!.star).toBeUndefined()
  })

  it('n ajoute rien entre deux expressions d origine', () => {
    expect('face' in blendExpression(expr('neutre'), expr('colere'), 0.5)).toBe(false)
  })
})

describe('rendu des nouvelles expressions', () => {
  it('pose une bouche et les bons styles d yeux', () => {
    const attendus: Record<string, { marks: number; plein: boolean }> = {
      joyeux: { marks: 2, plein: false },
      etoile: { marks: 2, plein: true },
      clin: { marks: 1, plein: false },
      chante: { marks: 2, plein: false },
      endormi: { marks: 2, plein: false },
      concentre: { marks: 0, plein: false }
    }
    for (const id of NOUVELLES) {
      const f = new BotEngine(R, 'idle', cercle(), expr(id)).sample(1)
      expect(f.mouth, id).not.toBeNull()
      expect(f.mouth!.alpha, id).toBeGreaterThan(0.9)
      expect(f.marks, id).toHaveLength(attendus[id]!.marks)
      for (const m of f.marks) expect(!m.stroke, id).toBe(attendus[id]!.plein)
      // la bouche est SOUS les yeux
      const yeux = f.eyes.map((e) => +e.matrix.split(',')[5]!.slice(0, -1))
      const bouche = Math.min(...points(f.mouth!.d).map((p) => p.y))
      expect(bouche, id).toBeGreaterThan(Math.max(...yeux))
    }
  })

  it('le clin d oeil garde une gelule ouverte et remplace l autre par un arc', () => {
    const f = new BotEngine(R, 'idle', cercle(), expr('clin')).sample(1)
    expect(f.eyes[0]!.alpha).toBeGreaterThan(0.9)
    expect(f.eyes[1]!.alpha).toBe(0)
    expect(f.marks[0]!.eye).toBe(1)
  })

  it('les expressions d origine n ont ni bouche ni style', () => {
    for (const e of EXPRESSIONS) {
      if (NOUVELLES.includes(e.id)) continue
      const f = new BotEngine(R, 'idle', cercle(), e).sample(1)
      expect(f.mouth, e.id).toBeNull()
      expect(f.marks, e.id).toEqual([])
    }
  })

  it('n incline aucun oeil en miroir et regarde a peu pres de face', () => {
    for (const id of NOUVELLES) {
      const e = expr(id)
      expect(Math.abs(e.gaze.pitch), id).toBeLessThanOrEqual(8)
      for (const oeil of e.eyes) expect(Math.abs(oeil.tilt ?? 0), id).toBe(0)
    }
  })

  it('garde la bouche dans le corps, sur toutes les formes', () => {
    const fautifs: string[] = []
    for (const forme of SHAPES) {
      for (const id of NOUVELLES) {
        const e = new BotEngine(R, 'idle', forme.radii, expr(id))
        for (let t = 0; t < 3; t += 0.1) {
          const f = e.sample(t)
          const corps = contour(f.bodyPath)
          const pire = Math.min(...points(f.mouth!.d).map((p) => marge(corps, p.x, p.y)))
          // la demi-epaisseur du trait doit tenir aussi
          if (pire < f.mouth!.width / 2) fautifs.push(`${forme.id}/${id} ${pire.toFixed(1)}`)
        }
      }
    }
    expect([...new Set(fautifs)]).toEqual([])
  })
})

describe('nouveaux etats', () => {
  it('restent une fonction pure du temps', () => {
    for (const id of NOUVEAUX) {
      const e = new BotEngine(R, id, cercle())
      const avant = e.sample(1.3)
      e.sample(4)
      e.sample(0.2)
      expect(e.sample(1.3), id).toEqual(avant)
    }
  })

  it('montrent une bouche et leurs styles d yeux a leur pose', () => {
    const avecMarks: StateId[] = ['cheer', 'sing', 'doze']
    for (const id of NOUVEAUX) {
      const f = new BotEngine(R, id, cercle()).sample(STATE_BY_ID.get(id)!.duration / 2 + 1.5)
      expect(f.mouth, id).not.toBeNull()
      expect(f.eyes, id).toHaveLength(2)
      if (avecMarks.includes(id)) expect(f.marks.length, id).toBe(2)
    }
  })

  it('bouclent sans couture', () => {
    for (const id of ['typing', 'cheer', 'sing'] as const) {
      const def = STATE_BY_ID.get(id)!
      for (const t of [0, 0.37, 1.1]) {
        const a = def.pose(t)
        const b = def.pose(t + def.duration)
        expect(b.offY, id).toBeCloseTo(a.offY, 6)
        expect(b.sil.sy, id).toBeCloseTo(a.sil.sy, 6)
        expect(b.gaze.pitch, id).toBeCloseTo(a.gaze.pitch, 6)
        expect(b.face!.mouth!.open, id).toBeCloseTo(a.face!.mouth!.open, 6)
      }
    }
    // `doze` s'endort puis TIENT : sa respiration boucle sur elle-meme
    const doze = STATE_BY_ID.get('doze')!
    expect(doze.pose(10 + 2.6).sil.sy).toBeCloseTo(doze.pose(10).sil.sy, 6)
  })

  it('appliquent la forme choisie', () => {
    for (const id of NOUVEAUX) expect(STATE_BY_ID.get(id)!.baseBody, id).toBe(true)
  })

  it('gardent la bouche dans le corps pendant l animation', () => {
    const fautifs: string[] = []
    for (const forme of SHAPES) {
      for (const id of NOUVEAUX) {
        const e = new BotEngine(R, id, forme.radii)
        for (let t = 0; t < 6.5; t += 0.05) {
          const f = e.sample(t)
          if (!f.mouth) continue
          const corps = contour(f.bodyPath)
          const pire = Math.min(...points(f.mouth.d).map((p) => marge(corps, p.x, p.y)))
          if (pire < f.mouth.width / 2) fautifs.push(`${forme.id}/${id}`)
        }
      }
    }
    expect([...new Set(fautifs)]).toEqual([])
  })
})
