// Общая 3D-геометрия тела для решателя и 3D-рига: ширины, положение
// колена и коллизии грифа с ногами. Без зависимостей. Единицы — см.

const D2R = Math.PI / 180

export const v3 = (x, y, z) => ({ x, y, z })
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z)
const addv = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z)
const scale = (a, k) => v3(a.x * k, a.y * k, a.z * k)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a) => Math.sqrt(dot(a, a))
const norm = (a) => scale(a, 1 / (len(a) || 1))
export const dist3 = (a, b) => len(sub(a, b))
export { addv, scale, sub }

// Радиусы капсул сегментов для роста 178 см. Одни и те же числа рисуются
// в 3D и участвуют в коллизиях — иначе гриф «проходит» сквозь ногу.
export const LIMB_R = {
  pelvis: 9.5,
  abdomen: 11,
  chest: 12,
  shoulders: 5.5,
  neck: 5,
  thigh: 7.5,
  shin: 5.2,
  foot: 3.8,
  upperArm: 4.8,
  forearm: 3.9,
}

// Смещение капсулы назад от оси кости, см. Голень: большеберцовая кость
// спереди прямо под кожей, а икра сзади — капсула сдвинута назад.
export const LIMB_BACK = { shin: 2 }

// Средний сустав цепочки P —L1— X —L2— Q, ближайший к направлению pref.
// Если цепочка не дотягивается, выпрямляем её вдоль P→Q.
export function midJoint(P, Q, L1, L2, pref) {
  const d = sub(Q, P)
  const D = len(d)
  const e = norm(d)
  if (D >= L1 + L2) return addv(P, scale(e, L1 * (D / (L1 + L2))))
  const along = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
  const r = Math.sqrt(Math.max(0, L1 * L1 - along * along))
  const w = sub(pref, scale(e, dot(pref, e)))
  const p = norm(len(w) > 1e-6 ? w : v3(0, 1, 0))
  return addv(addv(P, scale(e, along)), scale(p, r))
}

// Ширины, см
export function widths(body, lift, opts = {}) {
  const H = body.height
  const k = H / 178
  const s = body.L.shoulderW / 2 - 2
  const pelvisHalf = 0.048 * H
  const legReach = body.L.shin + body.L.thigh
  let stanceHalf
  let gripHalf
  if (lift === 'squat') {
    stanceHalf = Math.max(pelvisHalf + 6, body.L.shoulderW * 0.55)
    gripHalf = s + (opts.barPosition === 'low' ? 20 : 14)
  } else if (lift === 'deadlift' && opts.style === 'sumo') {
    const st = (opts.sumoStance ?? 45) * D2R
    stanceHalf = pelvisHalf + legReach * 0.42 * Math.sin(st)
    gripHalf = s * 0.78
  } else {
    stanceHalf = pelvisHalf + 2
    // кисти снаружи голеней: радиус голени + радиус предплечья + зазор
    gripHalf = stanceHalf + (LIMB_R.shin + LIMB_R.forearm + 2) * k
  }
  return { s, pelvisHalf, stanceHalf, gripHalf, k }
}

// Угол разворота колен и стоп наружу
export function stanceAngle(lift, opts = {}) {
  if (lift === 'deadlift') {
    return (opts.style === 'sumo' ? (opts.sumoStance ?? 45) : 10) * D2R
  }
  return (opts.stance ?? 30) * D2R
}

// Колено одной ноги в 3D: таз и голеностоп из решателя (вид сбоку) плюс
// ширины; колено — пересечение сфер голени и бедра, развёрнутое наружу.
export function legJoints(body, W, theta, H, A, sg) {
  const hip = v3(H.x, H.y, sg * W.pelvisHalf)
  const ankle = v3(A.x, A.y, sg * W.stanceHalf)
  const out = v3(Math.cos(theta), 0, sg * Math.sin(theta))
  const knee = midJoint(ankle, hip, body.L.shin, body.L.thigh, out)
  return { hip, ankle, knee, out }
}

// Расстояние от точки до отрезка в боковой проекции (x, y). Гриф — это
// длинный цилиндр вдоль оси z, поэтому его расстояние до сегмента ноги
// равно расстоянию в проекции на плоскость xy.
function pointSegment2(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Глубина проникновения капсулы грифа в капсулы голени и бедра, см
// (0 — касание или зазор). Если нога на высоте грифа оказалась впереди
// его оси, гриф уже «прошёл сквозь» неё — глубина больше суммы радиусов.
export function barLegPenetration(body, W, theta, H, A, bar, barR) {
  const { knee, hip, ankle } = legJoints(body, W, theta, H, A, 1)
  let depth = 0
  const back = LIMB_BACK.shin * W.k * Math.cos(theta)
  const shinA = v3(ankle.x - back, ankle.y, ankle.z)
  const shinB = v3(knee.x - back, knee.y, knee.z)
  for (const [a, b, r] of [
    [shinA, shinB, LIMB_R.shin],
    [knee, hip, LIMB_R.thigh],
  ]) {
    const rs = r * W.k + barR
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    if (bar.y >= lo && bar.y <= hi && b.y !== a.y) {
      const x = a.x + ((bar.y - a.y) / (b.y - a.y)) * (b.x - a.x)
      if (x > bar.x) {
        depth = Math.max(depth, x - bar.x + rs)
        continue
      }
    }
    depth = Math.max(depth, rs - pointSegment2(bar, a, b))
  }
  return depth
}
