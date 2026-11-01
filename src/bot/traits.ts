import { clamp, lerp, r2 } from './math'

/**
 * Traits du visage en plus des deux gelules : une bouche, et trois styles d'yeux.
 *
 * Ce ne sont PAS des mesures de la video — le bot de reference n'a ni bouche ni yeux
 * en arc. Ils sont CHOISIS, comme `swirl` et `--ink`, d'apres les cartes animees de
 * `studio/bloub-cards.ts`. Aucune constante mesuree n'en depend, et tout ce qui n'en
 * declare pas rend exactement ce qu'il rendait.
 *
 * Comme les yeux, ce sont des TROUS dans le masque du corps : ils marchent donc avec
 * toutes les couleurs et tous les fonds, et se rognent seuls contre la silhouette.
 */

/** Bouche en « D » arrondi. Toutes les grandeurs sont en unites de rayon de boule. */
export interface Bouche {
  /** -1 = coins vers le bas, 1 = sourire franc */
  smile: number
  /** 0 = simple trait de sourire, 1 = machoire grande ouverte */
  open: number
  /** demi-largeur */
  w: number
}

/**
 * Extras du visage. Les styles d'yeux sont des POIDS par oeil, [interieur, exterieur]
 * comme `Pose.eyes` : la gelule s'efface a mesure que leur somme monte, ce qui permet un
 * clin d'oeil fait d'une gelule et d'un arc.
 */
export interface FaceExtras {
  mouth?: Bouche
  /** arc « ∩ » des yeux rieurs */
  happy?: [number, number]
  /** etincelle a quatre branches */
  star?: [number, number]
  /** arc « ‿ » des yeux endormis */
  sleep?: [number, number]
}

const ZERO: [number, number] = [0, 0]
const SANS_BOUCHE: Bouche = { smile: 0, open: 0, w: 0 }

const lerpPaire = (a: [number, number] | undefined, b: [number, number] | undefined, t: number) =>
  a || b
    ? ([lerp((a ?? ZERO)[0], (b ?? ZERO)[0], t), lerp((a ?? ZERO)[1], (b ?? ZERO)[1], t)] as [
        number,
        number
      ])
    : undefined

/**
 * Interpolation lineaire de deux jeux d'extras. Ce qui manque vaut zero : une bouche
 * absente est une bouche de largeur nulle, donc elle POUSSE au lieu d'apparaitre.
 * Deux visages sans extras donnent `undefined`, pour que les etats existants gardent
 * exactement leur pose.
 */
export function blendFace(
  a: FaceExtras | undefined,
  b: FaceExtras | undefined,
  t: number
): FaceExtras | undefined {
  if (!a && !b) return undefined
  const out: FaceExtras = {}
  if (a?.mouth || b?.mouth) {
    const ma = a?.mouth ?? SANS_BOUCHE
    const mb = b?.mouth ?? SANS_BOUCHE
    out.mouth = {
      smile: lerp(ma.smile, mb.smile, t),
      open: lerp(ma.open, mb.open, t),
      w: lerp(ma.w, mb.w, t)
    }
  }
  const happy = lerpPaire(a?.happy, b?.happy, t)
  const star = lerpPaire(a?.star, b?.star, t)
  const sleep = lerpPaire(a?.sleep, b?.sleep, t)
  if (happy) out.happy = happy
  if (star) out.star = star
  if (sleep) out.sleep = sleep
  return out
}

/** Poids total des styles d'yeux sur l'oeil `i` : ce qui efface la gelule. */
export function poidsDesStyles(face: FaceExtras | undefined, i: number): number {
  if (!face) return 0
  return (face.happy?.[i] ?? 0) + (face.star?.[i] ?? 0) + (face.sleep?.[i] ?? 0)
}

/* ------------------------------------------------------------- geometrie */

/**
 * Repere du visage a l'ecran : une origine, l'axe qui va d'un oeil a l'autre et sa
 * perpendiculaire vers le bas. Il suit donc le roulis de la tete sans calcul de plus.
 */
export interface RepereVisage {
  x: number
  y: number
  ux: number
  uy: number
  vx: number
  vy: number
}

/** Chemin trace dans le repere du visage, coordonnees locales en unites de viewBox. */
function trace(rep: RepereVisage, ox: number, oy: number, cmds: Array<[string, number[]]>) {
  return cmds
    .map(([c, n]) => {
      const out: string[] = []
      for (let i = 0; i < n.length; i += 2) {
        const lx = ox + n[i]!
        const ly = oy + n[i + 1]!
        out.push(`${r2(rep.x + lx * rep.ux + ly * rep.vx)} ${r2(rep.y + lx * rep.uy + ly * rep.vy)}`)
      }
      return c + out.join(' ')
    })
    .join('')
}

/** Descente de la bouche sous le milieu des yeux, en unites de rayon. */
export const BOUCHE_SOUS_YEUX = 0.27
/** Epaisseur du trait de bouche : c'est lui qui emousse les coins et dessine le sourire ferme. */
export const BOUCHE_TRAIT = 0.05
/** Epaisseur des arcs d'yeux. */
export const ARC_TRAIT = 0.065

/**
 * La bouche, d'un seul chemin ferme : courbe du haut, puis cuvette. Les coins sont
 * emousses par le trait arrondi, jamais en V. Bouche fermee, les deux courbes se
 * rejoignent presque et c'est le trait qui fait le sourire.
 */
export function cheminBouche(rep: RepereVisage, b: Bouche, R: number): string {
  const w = b.w * R
  const coin = -b.smile * 0.035 * R
  const haut = b.smile * 0.045 * R
  const bas = haut + clamp(b.open, 0, 1.4) * 0.24 * R
  return (
    trace(rep, 0, 0, [
      ['M', [-w, coin]],
      ['C', [-w * 0.45, haut, w * 0.45, haut, w, coin]],
      ['C', [w * 0.95, bas, -w * 0.95, bas, -w, coin]]
    ]) + 'Z'
  )
}

/** Arc « ∩ » des yeux rieurs, centre sur l'oeil. */
export function cheminRieur(rep: RepereVisage, ox: number, R: number): string {
  const k = R / 100
  return trace(rep, ox, 0, [
    ['M', [-10 * k, 5 * k]],
    ['C', [-10 * k, -7.5 * k, 10 * k, -7.5 * k, 10 * k, 5 * k]]
  ])
}

/** Arc « ‿ » des yeux endormis. */
export function cheminEndormi(rep: RepereVisage, ox: number, R: number): string {
  const k = R / 100
  return trace(rep, ox, 0, [
    ['M', [-13 * k, 0]],
    ['C', [-11 * k, 12 * k, 11 * k, 12 * k, 13 * k, 0]]
  ])
}

/** Etincelle a quatre branches, rayon `r` en unites de rayon de boule. */
export function cheminEtoile(rep: RepereVisage, ox: number, r: number, R: number): string {
  const pts: number[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2
    const rr = (k % 2 ? r * 0.32 : r) * R
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  return (
    trace(rep, ox, 0, [
      ['M', pts.slice(0, 2)],
      ['L', pts.slice(2)]
    ]) + 'Z'
  )
}
