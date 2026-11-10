import { barLegPenetration, LIMB_R, widths } from './skeleton.js'

// Решатель: на каждом кадре ищет позу, которая выполняет ограничения
// (баланс, мобильность, гриф не проходит сквозь голень, правила IPF)
// и даёт минимальную нагрузку на суставы относительно их силы:
//
//   J = Σ (M_j / C_j)²
//
// где M_j — статический момент в суставе, C_j — условная сила сустава.
// Это критерий минимального усилия (в духе Crowninshield & Brand, 1981).
//
// Система координат: сантиметры, x вперёд (к носкам; в жиме — к голове),
// y вверх, начало координат — середина стопы на полу.
// Моменты — в Н·м, в сагиттальной плоскости (вид сбоку).

const D2R = Math.PI / 180
const R2D = 180 / Math.PI
const G = 9.81
const { sin, cos, sqrt, atan2, abs, max, min, hypot } = Math

// Условная максимальная сила суставов, Н·м на кг массы тела (обе стороны).
// Порядок величин по данным изокинетики у тренированных; важны соотношения.
export const CAPACITY = {
  hip: 3.6,
  knee: 3.0,
  ankle: 2.4,
  shoulder: 1.1, // одна рука
  elbow: 0.75, // одна рука
}

// Положение грифа относительно плечевого сустава вдоль торса (вниз)
// и от оси торса назад (толщина спины)
export const BAR_POSITIONS = {
  high: { down: 3, back: 5 },
  low: { down: 8, back: 7 },
}

const PLATE_R = 22.5 // радиус блина 450 мм
const BAR_R = 1.4 // радиус грифа (28–29 мм)
const BENCH_TOP = 43 // высота скамьи, см
const IPF_GRIP_MAX = 81 // макс. расстояние между указательными пальцами

const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y })
const mul = (p, k) => ({ x: p.x * k, y: p.y * k })
const lerp = (p, q, t) => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
})

function bisect(f, lo, hi, iters = 40) {
  let flo = f(lo)
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (fm < 0 === flo < 0) {
      lo = mid
      flo = fm
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// Общая часть для приседа и тяги: ноги, моменты, центр масс
// ---------------------------------------------------------------------------

// Ноги. a — наклон голени вперёд от вертикали, beta — угол бедра от
// вертикали (90° — параллель). stance — разворот колен/носков наружу:
// сегменты лежат в плоскости, повёрнутой на stance, поэтому в боковой
// проекции горизонтальные компоненты укорачиваются на cos(stance).
function legs(body, stance, a, beta) {
  const { L } = body
  const cT = cos(stance)
  const A = { x: -0.25 * L.foot * cT, y: L.ankleH }
  const K = { x: A.x + L.shin * sin(a) * cT, y: A.y + L.shin * cos(a) }
  const H = { x: K.x - L.thigh * sin(beta) * cT, y: K.y + L.thigh * cos(beta) }
  return {
    A,
    K,
    H,
    toe: { x: 0.5 * L.foot * cT, y: 0 },
    heel: { x: -0.5 * L.foot * cT, y: 0 },
  }
}

// Сгибание в тазобедренном суставе (3D): угол между бедром и торсом
function hipFlexion(stance, beta, phi) {
  const thigh = [sin(beta) * cos(stance), -cos(beta), sin(beta) * sin(stance)]
  const trunk = [sin(phi), cos(phi), 0]
  const dot = thigh[0] * trunk[0] + thigh[1] * trunk[1]
  return 180 - Math.acos(max(-1, min(1, dot))) * R2D
}

// items: [{ m, p, seg }], seg ∈ upper | thigh | shank | foot
function lowerMoments(items, A, K, H) {
  let hip = 0
  let knee = 0
  let ankle = 0
  let mx = 0
  let mt = 0
  for (const { m, p, seg } of items) {
    mx += m * p.x
    mt += m
    if (seg === 'foot') continue
    ankle += m * (p.x - A.x)
    if (seg === 'shank') continue
    knee += m * (K.x - p.x)
    if (seg === 'thigh') continue
    hip += m * (p.x - H.x)
  }
  const k = G / 100
  return { hip: hip * k, knee: knee * k, ankle: ankle * k, comX: mx / mt }
}

function utilLower(mom, W) {
  return {
    hip: mom.hip / (CAPACITY.hip * W),
    knee: mom.knee / (CAPACITY.knee * W),
    ankle: mom.ankle / (CAPACITY.ankle * W),
  }
}

const sq = (v) => v * v
const costOf = (u) => Object.values(u).reduce((s, v) => s + sq(v), 0)

// Сначала минимальное нарушение ограничений (с допуском), затем минимум
// нагрузки. Иначе штраф за неустранимое нарушение уводит позу в крайность.
function pickBest(cands, tol = 1.5) {
  if (!cands.length) return null
  const minViol = min(...cands.map((c) => c.viol))
  let best = null
  for (const c of cands) {
    if (c.viol > minViol + tol) continue
    if (!best || c.score < best.score) best = c
  }
  return best
}

function peakOf(frames) {
  let best = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].cost > frames[best].cost) best = i
  }
  return best
}

// ---------------------------------------------------------------------------
// Присед
// ---------------------------------------------------------------------------

function squatPose(body, o, a, beta, phi) {
  const { L, m, com } = body
  const lg = legs(body, o.stance, a, beta)
  const { A, K, H } = lg
  const u = { x: sin(phi), y: cos(phi) }
  const n = { x: -cos(phi), y: sin(phi) } // назад от оси торса
  const S = add(H, mul(u, L.torso))
  const bp = BAR_POSITIONS[o.barPosition] ?? BAR_POSITIONS.high
  const B = add(add(H, mul(u, L.torso - bp.down)), mul(n, bp.back))
  const head = add(S, mul(u, L.headNeck * 0.5))

  const items = [
    { m: o.load, p: B, seg: 'upper' },
    { m: m.arms, p: B, seg: 'upper' },
    { m: m.headNeck, p: head, seg: 'upper' },
    { m: m.trunk, p: add(H, mul(u, L.torso * com.trunkFromHip)), seg: 'upper' },
    { m: m.thighs, p: lerp(H, K, com.thighFromHip), seg: 'thigh' },
    { m: m.shanks, p: lerp(K, A, com.shankFromKnee), seg: 'shank' },
    { m: m.feet, p: { x: 0, y: 3 }, seg: 'foot' },
  ]
  const mom = lowerMoments(items, A, K, H)
  return { ...lg, S, B, head, mom, phi }
}

export function solveSquat(body, opts) {
  const o = {
    load: opts.load,
    barPosition: opts.barPosition,
    stance: (opts.stance ?? 30) * D2R,
  }
  const N = 61
  const betaMax = (90 + (opts.depth ?? 3)) * D2R
  const ankleMax = body.mobility.ankle
  const hipMax = body.mobility.hip
  const W = body.weight
  const frames = []
  let aPrev = 0

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const beta = betaMax * t
    const cands = []
    for (let aDeg = 0; aDeg <= ankleMax + 1e-9; aDeg += 0.5) {
      const a = aDeg * D2R
      const f = (phi) => squatPose(body, o, a, beta, phi).mom.comX
      const lo = -20 * D2R
      const hi = 95 * D2R
      const flo = f(lo)
      const fhi = f(hi)
      let phi
      let balErr = 0
      if (flo > 0) {
        phi = lo
        balErr = flo
      } else if (fhi < 0) {
        phi = hi
        balErr = -fhi
      } else {
        phi = bisect(f, lo, hi)
      }
      const pose = squatPose(body, o, a, beta, phi)
      const hipFlex = hipFlexion(o.stance, beta, phi)
      const hipViol = max(0, hipFlex - hipMax)
      const util = utilLower(pose.mom, W)
      const cost = costOf(util)
      const score = cost + 0.002 * sq(aDeg - aPrev)
      const viol = hipViol + 2 * balErr
      cands.push({
        score,
        viol,
        cost,
        util,
        pose,
        aDeg,
        hipFlex,
        hipViol,
        balErr,
      })
    }
    const best = pickBest(cands)
    aPrev = best.aDeg
    const { pose } = best
    frames.push({
      t,
      pose,
      bar: pose.B,
      cost: best.cost,
      util: best.util,
      moments: pose.mom,
      angles: {
        trunk: pose.phi * R2D,
        knee: best.aDeg + beta * R2D,
        hip: best.hipFlex,
        ankle: best.aDeg,
      },
      violations: {
        hip: best.hipViol,
        balance: best.balErr,
        ankle: best.aDeg >= ankleMax - 0.25 ? 1 : 0,
      },
      kneeOverToe: pose.K.x - pose.toe.x,
    })
  }
  return summarizeSquat(frames, body, opts)
}

function summarizeSquat(frames, body, opts) {
  const bottom = frames.at(-1)
  const peak = peakOf(frames)
  const rom = frames[0].bar.y - bottom.bar.y
  const warnings = []
  if (frames.some((f) => f.violations.hip > 1)) {
    warnings.push(
      'Не хватает сгибания в тазу, чтобы присесть на эту глубину. Модель взяла максимум ваших углов: попробуйте шире постановку или проверьте подвижность.',
    )
  }
  if (frames.some((f) => f.violations.balance > 0.5)) {
    warnings.push(
      'Удержать центр масс над серединой стопы не удаётся: в нижней точке вас тянет назад. Нужна большая подвижность голеностопа или штангетки.',
    )
  }
  if (bottom.violations.ankle) {
    warnings.push(
      `В нижней точке голеностоп упирается в ваш предел (${body.mobility.ankle}°). Если это мешает, помогут штангетки.`,
    )
  }
  return {
    lift: 'squat',
    frames,
    order: 'down-up',
    peak,
    warnings,
    summary: {
      rom,
      work: (opts.load * G * rom) / 100,
      bottom: bottom.angles,
      kneeOverToe: bottom.kneeOverToe,
      peakUtil: frames[peak].util,
      peakBarY: frames[peak].bar.y,
      peakMoments: maxMoments(frames),
    },
  }
}

function maxMoments(frames) {
  const out = {}
  for (const f of frames) {
    for (const [k, v] of Object.entries(f.moments)) {
      if (k === 'comX') continue
      out[k] = max(out[k] ?? 0, v)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Становая тяга
// ---------------------------------------------------------------------------

export function deadliftGeometry(body, style, sumoStanceDeg) {
  const { L } = body
  const stance = (style === 'sumo' ? sumoStanceDeg : 10) * D2R
  const arm = L.upperArm + L.forearm + L.grip
  // Хват: классика — руки чуть шире плеч, сумо — уже плеч, внутри ног.
  const lateral = style === 'sumo' ? 0.22 * L.shoulderW : 0.08 * L.shoulderW
  const armV = sqrt(arm * arm - lateral * lateral)
  return { stance, armV }
}

// bx — смещение грифа вперёд от середины стопы. Обычно 0; больше нуля,
// только когда гриф иначе пересекается с бёдрами (выталкивание).
export function deadliftPose(body, o, yBar, a, bx = 0) {
  const { L, m, com } = body
  const S = { x: bx, y: yBar + o.armV } // плечо над грифом, руки отвесно
  const lg0 = legs(body, o.stance, a, 0)
  // Ищем угол бедра, при котором расстояние таз — плечо равно торсу
  const g = (beta) => {
    const { H } = legs(body, o.stance, a, beta)
    return hypot(S.x - H.x, S.y - H.y) - L.torso
  }
  if (g(0) > 0) return null // ноги не дотягиваются до такого положения
  let beta = null
  const step = 1 * D2R
  for (let b = 0; b < 175 * D2R; b += step) {
    if (g(b) <= 0 && g(b + step) > 0) {
      beta = bisect(g, b, b + step)
      break
    }
  }
  if (beta === null) return null
  const lg = legs(body, o.stance, a, beta)
  const { A, K, H } = lg
  const phi = atan2(S.x - H.x, S.y - H.y)
  const u = { x: sin(phi), y: cos(phi) }
  const B = { x: bx, y: yBar }
  const head = add(S, mul(u, L.headNeck * 0.5))

  // Коллизия: капсула грифа не должна входить в капсулы голени и бедра
  // (те же радиусы, что у 3D-модели)
  const contact = barLegPenetration(body, o.W, o.stance, H, A, B, BAR_R)

  const items = [
    { m: o.load, p: B, seg: 'upper' },
    { m: m.arms, p: { x: bx, y: yBar + o.armV / 2 }, seg: 'upper' },
    { m: m.headNeck, p: head, seg: 'upper' },
    { m: m.trunk, p: add(H, mul(u, L.torso * com.trunkFromHip)), seg: 'upper' },
    { m: m.thighs, p: lerp(H, K, com.thighFromHip), seg: 'thigh' },
    { m: m.shanks, p: lerp(K, A, com.shankFromKnee), seg: 'shank' },
    { m: m.feet, p: { x: 0, y: 3 }, seg: 'foot' },
  ]
  const mom = lowerMoments(items, A, K, H)
  return {
    ...lg,
    toe: lg0.toe,
    heel: lg0.heel,
    S,
    B,
    head,
    mom,
    phi,
    beta,
    contact,
  }
}

export function solveDeadlift(body, opts) {
  const geo = deadliftGeometry(body, opts.style, opts.sumoStance ?? 45)
  const o = { load: opts.load, ...geo, W: widths(body, 'deadlift', opts) }
  const { L } = body
  const W = body.weight
  const ankleMax = body.mobility.ankle
  const hipMax = body.mobility.hip

  // Локаут: ноги прямые, плечо над грифом. Гриф у локаута лежит на бёдрах,
  // поэтому он чуть впереди середины стопы — на толщину бедра.
  const lgTop = legs(body, o.stance, 0, 0)
  const bxTop = max(0, lgTop.A.x + LIMB_R.thigh * o.W.k + BAR_R)
  const lean = Math.asin(min(1, (bxTop - lgTop.H.x) / L.torso))
  const yTop = lgTop.H.y + L.torso * cos(lean) - o.armV
  const yStart = PLATE_R

  const N = 61
  const frames = []
  let aPrev = null
  let unreachable = false
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const yBar = yStart + (yTop - 0.3 - yStart) * t
    const evalAt = (aDeg, bx) => {
      const pose = deadliftPose(body, o, yBar, aDeg * D2R, bx)
      if (!pose) return null
      const hipFlex = hipFlexion(o.stance, pose.beta, pose.phi)
      const hipViol = max(0, hipFlex - hipMax)
      const util = utilLower(pose.mom, W)
      const cost = costOf(util)
      const cont = aPrev === null ? 0 : 0.002 * sq(aDeg - aPrev)
      // коллизия — почти жёсткое ограничение: 1 мм проникновения ≈ 2° таза
      const viol = hipViol + 20 * pose.contact
      return {
        score: cost + cont,
        viol,
        cost,
        util,
        pose,
        aDeg,
        hipFlex,
        hipViol,
      }
    }
    // Проход 1: гриф над серединой стопы
    let cands = []
    for (let aDeg = -10; aDeg <= ankleMax + 1e-9; aDeg += 0.5) {
      const c = evalAt(aDeg, 0)
      if (c) cands.push(c)
    }
    // Проход 2: если без пересечения с ногами не обойтись, выталкиваем
    // гриф вперёд ровно настолько, чтобы капсулы только касались
    // На последнем кадре (локаут) гриф лежит на бёдрах, поэтому выталкивание
    // пробуем всегда и сравниваем с позами без него.
    const lockout = i === N - 1
    if (lockout || !cands.some((c) => c.pose.contact < 0.05)) {
      const pushed = lockout ? cands.filter((c) => c.pose.contact < 0.05) : []
      const a0 = aPrev ?? 0
      for (
        let aDeg = max(-10, a0 - 12);
        aDeg <= min(ankleMax, a0 + 12) + 1e-9;
        aDeg += 0.5
      ) {
        for (let bx = 0.5; bx <= 15; bx += 0.5) {
          const c = evalAt(aDeg, bx)
          if (c && c.pose.contact < 0.05) {
            pushed.push(c)
            break
          }
        }
      }
      if (pushed.length) cands = pushed
    }
    const best = pickBest(cands)
    if (!best) {
      unreachable = true
      continue
    }
    aPrev = best.aDeg
    const { pose } = best
    frames.push({
      t,
      pose,
      bar: pose.B,
      cost: best.cost,
      util: best.util,
      moments: pose.mom,
      angles: {
        trunk: pose.phi * R2D,
        knee: best.aDeg + pose.beta * R2D,
        hip: best.hipFlex,
        ankle: best.aDeg,
      },
      violations: {
        hip: best.hipViol,
        shin: pose.contact,
        ankle: best.aDeg >= ankleMax - 0.25 ? 1 : 0,
      },
    })
  }

  const start = frames[0]
  const peak = peakOf(frames)
  const rom = frames.at(-1).bar.y - start.bar.y
  const warnings = []
  if (unreachable) {
    warnings.push(
      'С такими пропорциями до грифа на полу не дотянуться без нарушения ограничений модели. Проверьте длины рук и торса.',
    )
  }
  if (frames.some((f) => f.violations.shin > 0.5)) {
    warnings.push(
      'Модели не удалось провести гриф, не задев ноги: не хватает подвижности голеностопа или таза. Показан ближайший вариант.',
    )
  }
  if (frames.some((f) => f.violations.hip > 1)) {
    warnings.push(
      'Старт требует сгибания в тазу больше вашего предела. Сумо или более широкая постановка снимают это ограничение.',
    )
  }
  return {
    lift: 'deadlift',
    style: opts.style,
    frames,
    order: 'up-down',
    peak,
    warnings,
    summary: {
      rom,
      work: (opts.load * G * rom) / 100,
      start: start.angles,
      hipHeight: start.pose.H.y,
      shoulderHeight: start.pose.S.y,
      peakUtil: frames[peak].util,
      peakBarY: frames[peak].bar.y,
      peakMoments: maxMoments(frames),
    },
  }
}

// ---------------------------------------------------------------------------
// Жим лёжа
// ---------------------------------------------------------------------------

// Локоть: точка пересечения сфер (плечо, L плеча) и (кисть, L предплечья),
// ближайшая к желаемому направлению разведения локтей.
function solveElbow(S, Hd, Lu, Lf, flare) {
  const d = [Hd[0] - S[0], Hd[1] - S[1], Hd[2] - S[2]]
  let D = hypot(...d)
  const reach = Lu + Lf
  const clamped = D > reach
  if (clamped) D = reach - 1e-6
  const e = d.map((v) => v / hypot(...d))
  const along = (Lu * Lu - Lf * Lf + D * D) / (2 * D)
  const r = sqrt(max(0, Lu * Lu - along * along))
  // Желаемое направление: в стороны под углом flare к торсу и чуть вниз
  const w = [-cos(flare), -0.35, sin(flare)]
  const wd = w[0] * e[0] + w[1] * e[1] + w[2] * e[2]
  let p = [w[0] - wd * e[0], w[1] - wd * e[1], w[2] - wd * e[2]]
  const pn = hypot(...p) || 1
  p = p.map((v) => v / pn)
  const E = [0, 1, 2].map((k) => S[k] + e[k] * along + p[k] * r)
  return { E, clamped }
}

function benchGeometry(body, o) {
  const { L } = body
  const yS = BENCH_TOP + 0.04 * body.height // плечевой сустав над скамьёй
  const s = L.shoulderW / 2 - 2 // полуширина между плечевыми суставами
  const yChest = yS + 0.06 * body.height + o.arch // высота груди в точке касания
  const Lf = L.forearm + L.grip
  return { yS, s, yChest, Lf, Lu: L.upperArm }
}

function benchPoint(body, geo, o, xBar, yBar, g) {
  const S3 = [0, geo.yS, geo.s]
  const H3 = [xBar, yBar, g]
  const { E, clamped } = solveElbow(S3, H3, geo.Lu, geo.Lf, o.flare)
  const F = ((o.load + body.m.arms) / 2) * G // на одну руку
  const shoulder = (F * hypot(xBar, g - geo.s)) / 100
  const elbow = (F * hypot(xBar - E[0], g - E[2])) / 100
  const W = body.weight
  const util = {
    shoulder: shoulder / (CAPACITY.shoulder * W),
    elbow: elbow / (CAPACITY.elbow * W),
  }
  const ua = [E[0], E[1] - geo.yS, E[2] - geo.s]
  const fa = [xBar - E[0], yBar - E[1], g - E[2]]
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  const elbowAngle =
    180 - Math.acos(dot(ua, fa) / (hypot(...ua) * hypot(...fa))) * R2D
  return {
    S: { x: 0, y: geo.yS },
    E: { x: E[0], y: E[1] },
    B: { x: xBar, y: yBar },
    E3: E,
    g,
    s: geo.s,
    clamped,
    moments: { shoulder, elbow },
    util,
    cost: costOf(util),
    angles: {
      elbow: elbowAngle,
      // отклонение предплечья от вертикали: вид сбоку и вид с головы
      forearmSide: atan2(xBar - E[0], yBar - E[1]) * R2D,
      forearmFront: atan2(g - E[2], yBar - E[1]) * R2D,
    },
  }
}

function benchPath(body, opts, gripIndex) {
  const o = { load: opts.load, arch: opts.arch, flare: opts.flare * D2R }
  const geo = benchGeometry(body, o)
  const g = gripIndex / 2 + 4 // от середины до центра кисти
  const reach = geo.Lu + geo.Lf
  const yTop = geo.yS + sqrt(max(1, reach * reach - sq(g - geo.s))) - 0.5
  const yBottom = geo.yChest + BAR_R

  // Точка касания: от мечевидного отростка до сосковой линии
  let xTouch = 0
  let bestTouch = Infinity
  for (let x = -0.13 * body.height; x <= -0.03 * body.height; x += 0.5) {
    const c = benchPoint(body, geo, o, x, yBottom, g).cost
    if (c < bestTouch) {
      bestTouch = c
      xTouch = x
    }
  }

  // Подъём: на каждой высоте выбираем x грифа (монотонно к плечу)
  const N = 61
  const frames = []
  let xPrev = xTouch
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const yBar = yBottom + (yTop - yBottom) * t
    let best = null
    const xs = []
    const xMin = max(xPrev, xTouch * (1 - t))
    for (let x = xMin; x <= 0.001; x += 0.25) xs.push(x)
    if (i === 0) xs.splice(1)
    for (const x of xs) {
      const p = benchPoint(body, geo, o, x, yBar, g)
      const score = p.cost + 0.02 * sq(x - xMin)
      if (!best || score < best.score) best = { ...p, score }
    }
    xPrev = best.B.x
    frames.push({
      t,
      pose: best,
      bar: best.B,
      cost: best.cost,
      util: best.util,
      moments: best.moments,
      angles: best.angles,
    })
  }
  return { frames, geo, g, yTop, yBottom, xTouch }
}

export function solveBench(body, opts) {
  // Хват: если не задан, подбираем по минимуму пиковой нагрузки
  let gripIndex = opts.grip
  let auto = false
  if (!gripIndex) {
    auto = true
    let bestPeak = Infinity
    for (let gi = 40; gi <= IPF_GRIP_MAX; gi += 1) {
      const { frames } = benchPath(body, opts, gi)
      const peakCost = max(...frames.map((f) => f.cost))
      if (peakCost < bestPeak) {
        bestPeak = peakCost
        gripIndex = gi
      }
    }
  }
  const res = benchPath(body, opts, gripIndex)
  const flat = benchPath(body, { ...opts, arch: 0 }, gripIndex)
  const { frames } = res
  const rom = hypot(
    frames.at(-1).bar.x - frames[0].bar.x,
    frames.at(-1).bar.y - frames[0].bar.y,
  )
  const romFlat = hypot(
    flat.frames.at(-1).bar.x - flat.frames[0].bar.x,
    flat.frames.at(-1).bar.y - flat.frames[0].bar.y,
  )
  const peak = peakOf(frames)
  const warnings = []
  if (gripIndex > IPF_GRIP_MAX) {
    warnings.push(
      'Хват шире 81 см между указательными пальцами запрещён правилами IPF.',
    )
  }
  if (frames.some((f) => f.pose.clamped)) {
    warnings.push(
      'С таким хватом руки не достают до локаута: модель упирается в длину рук.',
    )
  }
  return {
    lift: 'bench',
    frames,
    order: 'down-up',
    reverse: true, // кадры идут снизу вверх, а повтор начинается сверху
    peak,
    warnings,
    geo: res.geo,
    summary: {
      rom,
      romFlat,
      work: (opts.load * G * rom) / 100,
      grip: gripIndex,
      gripAuto: auto,
      shoulderW: body.L.shoulderW,
      touchX: res.xTouch,
      bottom: frames[0].angles,
      peakUtil: frames[peak].util,
      peakBarY: frames[peak].bar.y,
      peakMoments: maxMoments(frames),
    },
  }
}

export const CONSTANTS = { PLATE_R, BAR_R, BENCH_TOP, IPF_GRIP_MAX }
