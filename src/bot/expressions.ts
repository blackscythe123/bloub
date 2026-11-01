import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from './face'
import { lerp } from './math'
import type { EyeCfg } from './states'
import { blendFace, type FaceExtras } from './traits'

/**
 * Expression de repos du bot.
 *
 * Le visage ne tient qu'à deux gélules, donc tout se joue sur quatre leviers :
 * l'orientation de la tête, l'écart des yeux, leurs proportions, et
 * l'inclinaison propre de chaque œil. C'est ce dernier qui permet la colère et
 * la tristesse : elles demandent des inclinaisons EN MIROIR (les hauts qui
 * convergent ou divergent), impossible avec le seul roulis de tête qui incline
 * les deux yeux du même côté.
 *
 * Seul l'état de repos porte cette expression. Les états expressifs de la vidéo
 * (clin d'œil, yeux écarquillés, notification) gardent la leur : c'est elle
 * qu'on est venu reproduire.
 *
 * Les amplitudes s'appuient sur bible-strong-avatar-lab, qui expose le même
 * modèle (tête X/Y/Z, largeur et hauteur par œil, écart, angle par œil) : chez
 * eux la largeur va de 0,8 à 2,7 fois le neutre, la hauteur de 0,3 à 1,5, et
 * les angles jusqu'à ±80°. On reste dans cette enveloppe.
 */
/** Enumeres pour que la couche i18n verifie leurs traductions a la compilation. */
export type ExpressionId =
  | 'neutre'
  | 'attentif'
  | 'surpris'
  | 'excite'
  | 'heureux'
  | 'hilare'
  | 'colere'
  | 'triste'
  | 'effraye'
  | 'mefiant'
  | 'confus'
  | 'curieux'
  | 'fier'
  | 'timide'
  | 'blase'
  | 'somnolent'
  | 'joyeux'
  | 'etoile'
  | 'clin'
  | 'chante'
  | 'endormi'
  | 'concentre'

export interface BotExpression {
  id: ExpressionId
  gaze: HeadGaze
  split: number
  eyes: [EyeCfg, EyeCfg]
  /**
   * Bouche et styles d'yeux (`traits.ts`). Absent sur les seize expressions d'origine,
   * qui ne tiennent qu'aux gelules et rendent donc exactement ce qu'elles rendaient.
   */
  face?: FaceExtras
}

/** `tilt` en degrés, positif = le haut de la gélule part vers la droite. */
const eye = (w: number, h: number, tilt = 0, open = 1): EyeCfg => ({ w, h, tilt, open })

/** Les deux yeux identiques, inclinaisons en miroir si `tilt` est fourni. */
const pair = (w: number, h: number, tilt = 0, open = 1): [EyeCfg, EyeCfg] => [
  eye(w, h, tilt, open),
  eye(w, h, -tilt, open)
]

export const EXPRESSIONS: BotExpression[] = [
  {
    // la pose relevée image par image sur la vidéo de référence
    id: 'neutre',
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)]
  },
  {
    id: 'attentif',
    gaze: { yaw: 4, pitch: 5, roll: -4 },
    split: 16,
    eyes: pair(0.21, 0.44)
  },
  {
    id: 'surpris',
    gaze: { yaw: 3, pitch: -3, roll: 0 },
    split: 19,
    eyes: pair(0.45, 0.47)
  },
  {
    id: 'excite',
    gaze: { yaw: 6, pitch: -14, roll: 0 },
    split: 19.5,
    eyes: pair(0.4, 0.56, -10)
  },
  {
    // yeux plissés en arc : les hauts convergent légèrement
    id: 'heureux',
    gaze: { yaw: 5, pitch: 9, roll: 0 },
    split: 17,
    eyes: pair(0.27, 0.17, 14)
  },
  {
    id: 'hilare',
    gaze: { yaw: 4, pitch: 14, roll: 0 },
    split: 18,
    eyes: pair(0.34, 0.13, 20)
  },
  {
    // hauts des yeux qui convergent fort vers le centre + yeux étrécis
    id: 'colere',
    gaze: { yaw: 3, pitch: 7, roll: 0 },
    split: 17,
    eyes: pair(0.34, 0.15, 30)
  },
  {
    // l'inverse : les hauts divergent, et le regard tombe
    id: 'triste',
    gaze: { yaw: 3, pitch: -13, roll: 0 },
    split: 16,
    eyes: pair(0.22, 0.4, -28)
  },
  {
    id: 'effraye',
    gaze: { yaw: 2, pitch: -20, roll: 0 },
    split: 20.5,
    eyes: pair(0.4, 0.6)
  },
  {
    // un œil franchement plus fermé que l'autre
    id: 'mefiant',
    gaze: { yaw: 12, pitch: 6, roll: -6 },
    split: 16,
    eyes: [eye(0.21, 0.4), eye(0.22, 0.15)]
  },
  {
    // asymétrique sur les deux axes : tailles ET inclinaisons dépareillées.
    // L'œil plissé est volontairement plat (rapport 1,6) : à un rapport proche
    // de 1 il serait rond, et son inclinaison ne se verrait pas.
    id: 'confus',
    gaze: { yaw: -14, pitch: 3, roll: 8 },
    split: 16.5,
    eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)]
  },
  {
    // la tête penche : c'est le roulis qui porte la curiosité
    id: 'curieux',
    gaze: { yaw: 16, pitch: -9, roll: -15 },
    split: 16.5,
    eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)]
  },
  {
    id: 'fier',
    gaze: { yaw: 5, pitch: 17, roll: 0 },
    split: 17,
    eyes: pair(0.3, 0.15, 18)
  },
  {
    id: 'timide',
    gaze: { yaw: -19, pitch: -14, roll: -7 },
    split: 14,
    eyes: pair(0.17, 0.3)
  },
  {
    // fentes horizontales et regard qui part sur le côté
    id: 'blase',
    gaze: { yaw: -22, pitch: 2, roll: 0 },
    split: 16,
    eyes: pair(0.3, 0.12)
  },
  {
    // paupières à moitié tombées : on passe par `open`, donc l'écrasement
    // vertical à l'écran, le même mécanisme que le clignement
    id: 'somnolent',
    gaze: { yaw: 6, pitch: -9, roll: -3 },
    split: 16,
    eyes: pair(0.2, 0.42, 0, 0.42)
  },

  /*
   * Les six suivantes portent des extras (`traits.ts`) : bouche, yeux en arc, etoiles.
   * Elles sont CHOISIES, d'apres les cartes de `studio/`, et non relevees sur la video.
   * Deux regles les tiennent mignonnes : un regard quasi frontal (tangage proche de 0,
   * sinon la bouche file vers le bord), et AUCUNE inclinaison en miroir — des yeux qui
   * convergent sous un sourire se lisent comme un rictus mechant.
   *
   * Les gelules gardent des proportions ordinaires meme quand un style les efface : elles
   * restent la reference du placement (`eyefit.ts`) et le point de depart d'un morph.
   */
  {
    // arcs rieurs et grand sourire ouvert
    id: 'joyeux',
    gaze: { yaw: 4, pitch: 4, roll: 0 },
    split: 17,
    eyes: pair(0.2, 0.4),
    face: { mouth: { smile: 0.9, open: 0.55, w: 0.1 }, happy: [1, 1] }
  },
  {
    // yeux en etoiles, bouche ouverte d'emerveillement
    id: 'etoile',
    gaze: { yaw: 3, pitch: 4, roll: 0 },
    split: 18,
    eyes: pair(0.22, 0.42),
    face: { mouth: { smile: 0.8, open: 0.6, w: 0.09 }, star: [1, 1] }
  },
  {
    // clin d'oeil : la gelule interieure reste ouverte, l'autre devient un arc rieur
    id: 'clin',
    gaze: { yaw: 5, pitch: 4, roll: -3 },
    split: 17,
    eyes: pair(0.2, 0.42),
    face: { mouth: { smile: 0.85, open: 0.12, w: 0.085 }, happy: [0, 1] }
  },
  {
    // arcs rieurs et petite bouche ronde, celle d'une note tenue
    id: 'chante',
    gaze: { yaw: 3, pitch: 5, roll: 0 },
    split: 17,
    eyes: pair(0.2, 0.4),
    face: { mouth: { smile: 0.3, open: 0.6, w: 0.055 }, happy: [1, 1] }
  },
  {
    // arcs fermes vers le bas, bouche minuscule
    id: 'endormi',
    gaze: { yaw: 2, pitch: 0, roll: 0 },
    split: 17,
    eyes: pair(0.2, 0.4),
    face: { mouth: { smile: 0.1, open: 0.15, w: 0.035 }, sleep: [1, 1] }
  },
  {
    // les gelules d'origine, le regard qui baisse un peu, un petit « o »
    id: 'concentre',
    gaze: { yaw: 2, pitch: -6, roll: 0 },
    split: 16,
    eyes: pair(0.19, 0.38),
    face: { mouth: { smile: 0.1, open: 0.32, w: 0.04 } }
  }
]

export const EXPRESSION_BY_ID = new Map<string, BotExpression>(EXPRESSIONS.map((e) => [e.id, e]))
export const DEFAULT_EXPRESSION = 'neutre'

const lerpEyeCfg = (a: EyeCfg, b: EyeCfg, t: number): EyeCfg => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t),
  open: lerp(a.open, b.open, t)
})

/** Interpolation de deux expressions : le changement se fait en glissant. */
export function blendExpression(a: BotExpression, b: BotExpression, t: number): BotExpression {
  return {
    id: b.id,
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEyeCfg(a.eyes[0], b.eyes[0], t), lerpEyeCfg(a.eyes[1], b.eyes[1], t)],
    ...faceDe(blendFace(a.face, b.face, t))
  }
}

/** N'ajoute la cle que s'il y a des extras : les expressions d'origine gardent leur forme. */
const faceDe = (face: FaceExtras | undefined) => (face ? { face } : {})
