// 3D-скелет из кадра решателя. Решатель работает в боковой проекции
// (x вперёд, y вверх); здесь добавляется третья ось z — вправо от лифтёра.
// Колени и локти ставятся пересечением двух сфер, поэтому длины сегментов
// сохраняются точно. Модуль не зависит от three.js. Единицы — сантиметры.

import { CONSTANTS } from './solver.js'
import {
  addv,
  dist3,
  LIMB_BACK,
  LIMB_R,
  legJoints,
  midJoint,
  scale,
  stanceAngle,
  sub,
  v3,
  widths,
} from './skeleton.js'

const { BENCH_TOP } = CONSTANTS
const D2R = Math.PI / 180

export { dist3, midJoint, widths }
// Сегменты манекена: [имя, сустав A, сустав B, радиус, сжатие по глубине,
// растяжение по ширине]. Радиусы — для роста 178 см, масштабируются.
// Радиусы берутся из LIMB_R — те же, что в коллизиях решателя.
const R = LIMB_R
export const SEGMENTS = [
  ['pelvis', 'hipL', 'hipR', R.pelvis, 1, 1],
  ['abdomen', 'pelvisC', 'chestC', R.abdomen, 0.85, 1.35],
  ['chest', 'chestC', 'neckBase', R.chest, 0.9, 1.5],
  ['shoulders', 'shoulderL', 'shoulderR', R.shoulders, 1, 1],
  ['neck', 'neckBase', 'headBase', R.neck, 1, 1],
  ['thighL', 'hipL', 'kneeL', R.thigh, 1, 1],
  ['thighR', 'hipR', 'kneeR', R.thigh, 1, 1],
  ['shinL', 'kneeL', 'ankleL', R.shin, 1, 1],
  ['shinR', 'kneeR', 'ankleR', R.shin, 1, 1],
  ['footL', 'heelL', 'toeL', R.foot, 0.8, 1.4],
  ['footR', 'heelR', 'toeR', R.foot, 0.8, 1.4],
  ['upperArmL', 'shoulderL', 'elbowL', R.upperArm, 1, 1],
  ['upperArmR', 'shoulderR', 'elbowR', R.upperArm, 1, 1],
  ['forearmL', 'elbowL', 'handL', R.forearm, 1, 1],
  ['forearmR', 'elbowR', 'handR', R.forearm, 1, 1],
]

// Шарниры, которые подсвечиваются цветом (как в 2D)
export const MARKERS = {
  standing: {
    hip: ['hipL', 'hipR'],
    knee: ['kneeL', 'kneeR'],
    ankle: ['ankleL', 'ankleR'],
  },
  bench: {
    hip: ['shoulderL', 'shoulderR'],
    knee: ['elbowL', 'elbowR'],
    ankle: [],
  },
}

function standingJoints(body, lift, opts, frame, W) {
  const { L } = body
  const p = frame.pose
  const theta = stanceAngle(lift, opts)
  const j = {}
  const offsets = {}
  for (const sg of [-1, 1]) {
    const side = sg < 0 ? 'L' : 'R'
    // та же функция, что в коллизиях решателя
    const { hip, ankle, knee, out } = legJoints(body, W, theta, p.H, p.A, sg)
    j[`hip${side}`] = hip
    j[`ankle${side}`] = ankle
    j[`knee${side}`] = knee
    offsets[`shin${side}`] = scale(out, -LIMB_BACK.shin * W.k)
    j[`toe${side}`] = v3(
      ankle.x + out.x * L.foot * 0.75,
      1.5,
      ankle.z + out.z * L.foot * 0.75,
    )
    j[`heel${side}`] = v3(
      ankle.x - out.x * L.foot * 0.25,
      1.5,
      ankle.z - out.z * L.foot * 0.25,
    )
  }
  const u = v3(Math.sin(p.phi), Math.cos(p.phi), 0)
  const S = v3(p.S.x, p.S.y, 0)
  const pelvisC = v3(p.H.x, p.H.y, 0)
  j.pelvisC = pelvisC
  j.chestC = addv(pelvisC, scale(sub(S, pelvisC), 0.5))
  j.neckBase = addv(S, scale(u, 2))
  j.headBase = addv(S, scale(u, L.headNeck * 0.32))
  j.head = addv(S, scale(u, L.headNeck * 0.62))

  const Lfa = L.forearm + L.grip
  for (const sg of [-1, 1]) {
    const side = sg < 0 ? 'L' : 'R'
    const sh = v3(S.x, S.y, sg * W.s)
    j[`shoulder${side}`] = sh
    let hand
    let pref
    if (lift === 'squat') {
      hand = v3(p.B.x - 1, p.B.y + 1, sg * W.gripHalf)
      pref = v3(-Math.cos(p.phi), -Math.sin(p.phi) - 0.6, sg * 0.3) // назад и вниз
    } else {
      hand = v3(p.B.x, p.B.y, sg * W.gripHalf)
      pref = v3(-0.4, 0, sg)
    }
    j[`hand${side}`] = hand
    j[`elbow${side}`] = midJoint(sh, hand, L.upperArm, Lfa, pref)
  }
  return { joints: j, offsets }
}

function benchJoints(body, opts, frame, W, geo) {
  const { L } = body
  const p = frame.pose
  const j = {}
  // Ось торса выше плечевых суставов: лопатки лежат на скамье, а сустав
  // ближе к спине, чем середина грудной клетки
  const lift = 4
  const yHip = BENCH_TOP + 10
  const dy = geo.yS + lift - yHip
  const pelvisC = v3(-Math.sqrt(Math.max(1, L.torso ** 2 - dy * dy)), yHip, 0)
  const S = v3(0, geo.yS + lift, 0)
  j.pelvisC = pelvisC
  // прогиб: середина торса поднята
  j.chestC = addv(
    scale(addv(pelvisC, S), 0.5),
    v3(0, 2 + (opts.arch ?? 0) * 0.8, 0),
  )
  j.neckBase = v3(4, geo.yS + lift, 0)
  j.headBase = v3(9, geo.yS + 2, 0)
  j.head = v3(15, geo.yS + 3, 0)

  const kneeAng = 28 * D2R
  for (const sg of [-1, 1]) {
    const side = sg < 0 ? 'L' : 'R'
    const hip = v3(pelvisC.x, pelvisC.y, sg * W.pelvisHalf)
    const knee = v3(
      hip.x - L.thigh * Math.cos(kneeAng) * 0.96,
      hip.y - L.thigh * Math.sin(kneeAng),
      sg * (W.pelvisHalf + 10),
    )
    const az = sg * (W.pelvisHalf + 20)
    const ady = knee.y - L.ankleH
    const adz = az - knee.z
    const ankle = v3(
      knee.x + Math.sqrt(Math.max(0, L.shin ** 2 - ady ** 2 - adz ** 2)),
      L.ankleH,
      az,
    )
    j[`hip${side}`] = hip
    j[`knee${side}`] = knee
    j[`ankle${side}`] = ankle
    j[`heel${side}`] = v3(ankle.x + L.foot * 0.25, 1.5, az)
    j[`toe${side}`] = v3(ankle.x - L.foot * 0.75, 1.5, az + sg * 6)

    const [ex, ey, ez] = p.E3
    j[`shoulder${side}`] = v3(0, geo.yS, sg * p.s)
    j[`elbow${side}`] = v3(ex, ey, sg * ez)
    j[`hand${side}`] = v3(p.B.x, p.B.y, sg * p.g)
  }
  return { joints: j, offsets: {} }
}

// Кадр решателя → суставы в 3D и положение грифа
export function rigFrame(body, res, index, opts) {
  const frame = res.frames[index]
  const W = widths(body, res.lift, opts)
  const joints =
    res.lift === 'bench'
      ? benchJoints(body, opts, frame, W, res.geo)
      : standingJoints(body, res.lift, opts, frame, W)
  // offsets — сдвиг капсулы относительно оси кости (голень назад)
  return { ...joints, bar: v3(frame.bar.x, frame.bar.y, 0) }
}
