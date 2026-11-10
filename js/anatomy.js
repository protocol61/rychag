// Анатомический слой поверх 3D-рига: системы координат костей, точки
// начала и прикрепления мышц и их нагрузка. Без three.js — только числа,
// поэтому всё здесь проверяется тестами.
//
// Локальная система каждого сегмента (для анатомически правой стороны):
//   x — вперёд (анатомически вентрально), y — вверх (проксимально),
//   z — латерально (наружу). Базис правый: z = x × y.
// Левая сторона — зеркало правой относительно плоскости z = 0: риг
// симметричен (это проверяют тесты рига).
//
// Мышцы — прямые линии действия между точками прикрепления, как в
// моделях OpenSim (Delp 1990, Rajagopal 2016), с промежуточными точками
// там, где мышца огибает сустав. Координаты точек — для роста 178 см
// в сантиметрах и масштабируются ростом; положение вдоль длинной кости
// задаётся долей её длины, поэтому подстраивается под замеры.

import { addv, scale, sub, v3 } from './skeleton.js'

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.sqrt(dot(a, a))
const norm = (a) => scale(a, 1 / (len(a) || 1))
const mirror = (p) => v3(p.x, p.y, -p.z)
// компонента a, перпендикулярная единичному вектору n
const perp = (a, n) => sub(a, scale(n, dot(a, n)))

// Базис по оси «вверх» и приблизительному латеральному направлению
function frame(o, up, latHint) {
  const u = norm(up)
  const lat = norm(perp(latHint, u))
  return { o, f: cross(u, lat), up: u, lat }
}

export function toWorld(F, x, y, z) {
  return addv(F.o, addv(addv(scale(F.f, x), scale(F.up, y)), scale(F.lat, z)))
}

export function toLocal(F, p) {
  const d = sub(p, F.o)
  return v3(dot(d, F.f), dot(d, F.up), dot(d, F.lat))
}

// Зеркальная копия системы: начало и оси отражаются, а латеральная ось
// после отражения смотрит медиально. Чтобы базис оставался вращением,
// третья ось берётся как x × y; геометрию левой стороны строим зеркально.
export function mirrorFrame(F) {
  const f = mirror(F.f)
  const up = mirror(F.up)
  return { o: mirror(F.o), f, up, lat: cross(f, up), mirrored: true }
}

// ---------------------------------------------------------------------------
// Системы координат по всем кадрам

// Ось шарнира (колено, локоть) по двум звеньям. На почти прямой
// конечности ось не определена — берём её из ближайшего согнутого кадра.
function hingeAxes(chains, sign, fallback) {
  const raw = chains.map(([P, M, Q]) => {
    const c = scale(cross(norm(sub(M, P)), norm(sub(Q, M))), sign)
    return len(c) > 0.08 ? norm(c) : null
  })
  return raw.map((c, i) => {
    if (c) return c
    for (let d = 1; d < raw.length; d++) {
      const near = raw[i - d] ?? raw[i + d]
      if (near) return near
    }
    return fallback(i)
  })
}

// Суффикс стороны рига, которая анатомически правая. В жиме лифтёр лежит
// головой к +x лицом вверх, и его правая рука оказывается со стороны −z.
export function rightSide(lift) {
  return lift === 'bench' ? 'L' : 'R'
}

export function anatomyFrames(lift, rigs) {
  const s = rightSide(lift)
  const torso = rigs.map(({ joints: j }) => {
    const mid = scale(addv(j.shoulderL, j.shoulderR), 0.5)
    const up = sub(mid, j.pelvisC)
    // правая сторона тела: +z стоя, −z лёжа на спине
    const lat = v3(0, 0, s === 'R' ? 1 : -1)
    return { ...frame(j.pelvisC, up, lat), length: len(up) }
  })
  const legLat = hingeAxes(
    rigs.map(({ joints: j }) => [j[`hip${s}`], j[`knee${s}`], j[`ankle${s}`]]),
    -1, // голень сгибается назад
    (i) => torso[i].lat,
  )
  const armLat = hingeAxes(
    rigs.map(({ joints: j }) => [
      j[`shoulder${s}`],
      j[`elbow${s}`],
      j[`hand${s}`],
    ]),
    1, // предплечье сгибается вперёд
    (i) => torso[i].lat,
  )
  return rigs.map(({ joints: j }, i) => {
    const T = torso[i]
    const foot = sub(j[`toe${s}`], j[`heel${s}`])
    const footUp = v3(0, 1, 0)
    return {
      T,
      TH: frame(j[`hip${s}`], sub(j[`hip${s}`], j[`knee${s}`]), legLat[i]),
      SH: frame(j[`knee${s}`], sub(j[`knee${s}`], j[`ankle${s}`]), legLat[i]),
      // стопа: x вдоль стопы к носку, y вверх
      FT: (() => {
        const lat = norm(cross(norm(foot), footUp))
        return {
          o: j[`ankle${s}`],
          f: norm(perp(foot, footUp)),
          up: footUp,
          lat,
        }
      })(),
      U: frame(
        j[`shoulder${s}`],
        sub(j[`shoulder${s}`], j[`elbow${s}`]),
        armLat[i],
      ),
      F: frame(j[`elbow${s}`], sub(j[`elbow${s}`], j[`hand${s}`]), armLat[i]),
      HD: frame(j.head, sub(j.head, j.headBase), T.lat),
    }
  })
}

// ---------------------------------------------------------------------------
// Мышцы

// Группы и их нагрузка из кадра решателя (util — момент в суставе в долях
// от силовых возможностей сустава; знак — направление момента).
// null — мышца в этом упражнении не моделируется.
const pos = (v) => Math.max(0, v)
const has = (u, ...keys) => keys.every((k) => typeof u[k] === 'number')
export const GROUPS = {
  glutes: {
    name: 'Ягодичные',
    drive: (u) => (has(u, 'hip') ? pos(u.hip) : null),
  },
  hamstrings: {
    name: 'Задняя поверхность бедра',
    drive: (u) =>
      has(u, 'hip', 'knee') ? Math.max(0.75 * pos(u.hip), pos(-u.knee)) : null,
  },
  adductors: {
    name: 'Большая приводящая',
    drive: (u) => (has(u, 'hip') ? 0.8 * pos(u.hip) : null),
  },
  erectors: {
    // момент в пояснице близок к моменту в тазобедренном суставе
    name: 'Разгибатели спины',
    drive: (u) => (has(u, 'hip') ? pos(u.hip) : null),
  },
  quads: {
    name: 'Квадрицепс',
    drive: (u) => (has(u, 'knee') ? pos(u.knee) : null),
  },
  calves: {
    name: 'Икроножная и камбаловидная',
    drive: (u) =>
      has(u, 'ankle', 'knee')
        ? Math.max(pos(u.ankle), 0.6 * pos(-u.knee))
        : null,
  },
  tibialis: {
    name: 'Передняя большеберцовая',
    drive: (u) => (has(u, 'ankle') ? pos(-u.ankle) : null),
  },
  pecs: {
    name: 'Большая грудная',
    drive: (u) => (has(u, 'shoulder') ? pos(u.shoulder) : null),
  },
  frontDelts: {
    name: 'Передняя дельта',
    drive: (u) => (has(u, 'shoulder') ? 0.85 * pos(u.shoulder) : null),
  },
  triceps: {
    name: 'Трицепс',
    drive: (u) => (has(u, 'elbow') ? pos(u.elbow) : null),
  },
}

// Точка: [сегмент, x, y, z]. Для длинных костей (TH, SH, U, F) и торса (T)
// y — доля длины сегмента: вниз от проксимального сустава для костей,
// вверх от центра таза для торса. Для Tsh (торс, от плечевого сустава),
// FT (стопа, от голеностопа) и HD (голова, от её центра) — сантиметры.
// P — надколенник, вычисляется по положению бедра и голени.
//
// tf — доли сухожилия на концах всего пути; flat — сплющенность широких
// мышц (ягодичная, грудная, широчайшая); r — радиус брюшка, см.
export const MUSCLES = [
  // --- таз и бедро
  {
    id: 'gluteusMaxSup',
    group: 'glutes',
    r: 2.6,
    flat: 0.45,
    tf: [0.08, 0.15],
    path: [
      ['T', -9, 0.2, 7],
      ['TH', -1, 0.1, 5.8],
    ],
  },
  {
    id: 'gluteusMaxMid',
    group: 'glutes',
    r: 3,
    flat: 0.45,
    tf: [0.06, 0.12],
    path: [
      ['T', -10.5, 0.1, 3],
      ['TH', -1.8, 0.2, 4.2],
    ],
  },
  {
    id: 'gluteusMaxInf',
    group: 'glutes',
    r: 2.6,
    flat: 0.45,
    tf: [0.06, 0.12],
    path: [
      ['T', -9, -0.04, 1.2],
      ['TH', -1.8, 0.28, 3.3],
    ],
  },
  {
    id: 'gluteusMed',
    group: 'glutes',
    r: 2.4,
    flat: 0.5,
    tf: [0.05, 0.2],
    path: [
      ['T', -1, 0.22, 13],
      ['TH', -0.6, 0.05, 5.6],
    ],
  },
  {
    id: 'tensorFasciaeLatae',
    r: 1.4,
    tf: [0.05, 0.7],
    path: [
      ['T', 4.5, 0.14, 11.5],
      ['TH', 0.5, 0.25, 6],
      ['TH', 0, 0.97, 3.8],
    ],
  },
  {
    id: 'iliopsoas',
    r: 2.2,
    tf: [0.05, 0.12],
    path: [
      ['T', -3, 0.35, 3.5],
      ['T', 4, 0.02, 7.5],
      ['TH', -1.2, 0.08, 2.6],
    ],
  },
  {
    id: 'rectusFemoris',
    group: 'quads',
    r: 2.2,
    tf: [0.12, 0.15],
    path: [['T', 4, 0.07, 9.5], ['P']],
  },
  {
    id: 'vastusLateralis',
    group: 'quads',
    r: 3,
    tf: [0.06, 0.12],
    path: [['TH', 0.3, 0.12, 4.8], ['P']],
  },
  {
    id: 'vastusMedialis',
    group: 'quads',
    r: 2.7,
    tf: [0.12, 0.04],
    path: [['TH', 0.5, 0.35, -1.2], ['P']],
  },
  {
    id: 'vastusIntermedius',
    group: 'quads',
    r: 2.2,
    tf: [0.05, 0.12],
    path: [['TH', 2.2, 0.2, 1.2], ['P']],
  },
  {
    id: 'patellarLigament',
    group: 'quads',
    tendon: true,
    r: 0.9,
    path: [['P'], ['SH', 3, 0.12, 0]],
  },
  {
    id: 'bicepsFemoris',
    group: 'hamstrings',
    r: 2.2,
    tf: [0.15, 0.2],
    path: [
      ['T', -4, -0.12, 5.5],
      ['SH', -1.5, 0.05, 3.4],
    ],
  },
  {
    id: 'semitendinosus',
    group: 'hamstrings',
    r: 1.7,
    tf: [0.1, 0.4],
    path: [
      ['T', -4.2, -0.13, 5],
      ['SH', 0.5, 0.12, -2.8],
    ],
  },
  {
    id: 'semimembranosus',
    group: 'hamstrings',
    r: 2,
    tf: [0.3, 0.1],
    path: [
      ['T', -3.8, -0.11, 5.8],
      ['SH', -1.8, 0.05, -2.8],
    ],
  },
  {
    id: 'adductorMagnus',
    group: 'adductors',
    r: 3,
    flat: 0.6,
    tf: [0.05, 0.1],
    path: [
      ['T', -3, -0.12, 4],
      ['TH', -1.6, 0.5, 0.8],
    ],
  },
  {
    id: 'adductorMagnusDistal',
    group: 'adductors',
    r: 2.6,
    tf: [0.1, 0.25],
    path: [
      ['T', -3.5, -0.13, 4.8],
      ['TH', -0.8, 0.88, -2.6],
    ],
  },
  {
    id: 'adductorLongus',
    r: 1.8,
    tf: [0.1, 0.1],
    path: [
      ['T', 4, -0.03, 3],
      ['TH', -1, 0.45, 0.5],
    ],
  },
  {
    id: 'gracilis',
    r: 1,
    tf: [0.1, 0.3],
    path: [
      ['T', 3, -0.08, 2],
      ['SH', 0.8, 0.11, -2.6],
    ],
  },
  {
    id: 'sartorius',
    r: 1.2,
    tf: [0.05, 0.1],
    path: [
      ['T', 4.5, 0.14, 11.5],
      ['TH', 2.5, 0.45, -1.5],
      ['SH', 1, 0.1, -2.7],
    ],
  },
  // --- голень
  {
    id: 'gastrocnemiusMed',
    group: 'calves',
    r: 2.6,
    tf: [0.08, 0.5],
    path: [
      ['TH', -2.6, 0.92, -2.2],
      ['FT', -5.5, -4.5, -0.2],
    ],
  },
  {
    id: 'gastrocnemiusLat',
    group: 'calves',
    r: 2.3,
    tf: [0.08, 0.52],
    path: [
      ['TH', -2.6, 0.92, 2.2],
      ['FT', -5.5, -4.5, 0.4],
    ],
  },
  {
    id: 'soleus',
    group: 'calves',
    r: 2.8,
    flat: 0.7,
    tf: [0.08, 0.35],
    path: [
      ['SH', -2.5, 0.2, 0.8],
      ['FT', -5.5, -4.5, 0.1],
    ],
  },
  {
    id: 'tibialisAnterior',
    group: 'tibialis',
    r: 1.5,
    tf: [0.05, 0.45],
    path: [
      ['SH', 2, 0.2, 1.8],
      ['SH', 2.2, 0.9, 0.3],
      ['FT', 5, -3, -2],
    ],
  },
  {
    id: 'fibularisLongus',
    r: 1.2,
    tf: [0.05, 0.5],
    path: [
      ['SH', -1.2, 0.08, 3.4],
      ['SH', -1.8, 0.95, 2.6],
      ['FT', 1, -5.5, 2.2],
    ],
  },
  // --- туловище
  {
    id: 'erectorLumbar',
    group: 'erectors',
    r: 2.6,
    tf: [0.08, 0.12],
    path: [
      ['T', -9, 0.06, 3],
      ['T', -11.5, 0.45, 3.5],
    ],
  },
  {
    id: 'erectorThoracic',
    group: 'erectors',
    r: 1.6,
    tf: [0.15, 0.2],
    path: [
      ['T', -11.5, 0.42, 4],
      ['T', -10.5, 0.92, 3],
    ],
  },
  {
    id: 'iliocostalis',
    group: 'erectors',
    r: 1.5,
    tf: [0.1, 0.2],
    path: [
      ['T', -6, 0.2, 9],
      ['T', -10, 0.62, 8],
    ],
  },
  {
    id: 'rectusAbdominis',
    r: 2.2,
    flat: 0.35,
    tf: [0.04, 0.04],
    path: [
      ['T', 4.5, -0.04, 1.5],
      ['T', 10, 0.3, 4],
      ['T', 10.5, 0.68, 5],
    ],
  },
  {
    id: 'obliqueExternal',
    r: 2.5,
    flat: 0.3,
    tf: [0.04, 0.2],
    path: [
      ['T', 6, 0.62, 12.5],
      ['T', 8.5, 0.22, 7],
    ],
  },
  {
    id: 'obliqueLateral',
    r: 2.2,
    flat: 0.3,
    tf: [0.04, 0.1],
    path: [
      ['T', 1, 0.55, 14],
      ['T', 3, 0.2, 12.5],
    ],
  },
  {
    id: 'latissimusUpper',
    r: 2.2,
    flat: 0.35,
    tf: [0.05, 0.3],
    path: [
      ['T', -11, 0.68, 1.5],
      ['Tsh', -6, -10, -3],
      ['U', 1.8, 0.1, -0.3],
    ],
  },
  {
    id: 'latissimusMid',
    r: 2.5,
    flat: 0.35,
    tf: [0.05, 0.3],
    path: [
      ['T', -10.5, 0.3, 2.5],
      ['Tsh', -5.5, -11, -2],
      ['U', 1.8, 0.12, -0.3],
    ],
  },
  {
    id: 'latissimusLat',
    r: 2,
    flat: 0.4,
    tf: [0.05, 0.3],
    path: [
      ['T', -5, 0.22, 12],
      ['Tsh', -4, -11, 0],
      ['U', 1.8, 0.14, -0.3],
    ],
  },
  {
    id: 'trapeziusUpper',
    r: 1.8,
    flat: 0.4,
    tf: [0.1, 0.1],
    path: [
      ['HD', -7, -3, 2.5],
      ['Tsh', -2, 3, -5],
    ],
  },
  {
    id: 'trapeziusMid',
    r: 2,
    flat: 0.3,
    tf: [0.1, 0.1],
    path: [
      ['T', -10.5, 0.88, 1],
      ['Tsh', -5, 1.5, -6],
    ],
  },
  {
    id: 'trapeziusLower',
    r: 1.8,
    flat: 0.3,
    tf: [0.1, 0.1],
    path: [
      ['T', -11.5, 0.5, 1],
      ['Tsh', -8.5, -2, -8],
    ],
  },
  {
    id: 'sternocleidomastoid',
    r: 1.3,
    tf: [0.1, 0.1],
    path: [
      ['HD', -2, -4, 6],
      ['T', 9.5, 0.95, 2.2],
    ],
  },
  // --- плечо и рука
  {
    id: 'pectoralisClavicular',
    group: 'pecs',
    r: 2.2,
    flat: 0.35,
    tf: [0.03, 0.25],
    path: [
      ['Tsh', 7, 0, -10],
      ['U', 2.2, 0.12, 0.8],
    ],
  },
  {
    id: 'pectoralisSternal',
    group: 'pecs',
    r: 2.8,
    flat: 0.35,
    tf: [0.03, 0.25],
    path: [
      ['T', 10.8, 0.82, 1.5],
      ['U', 2.2, 0.14, 0.8],
    ],
  },
  {
    id: 'pectoralisAbdominal',
    group: 'pecs',
    r: 2.4,
    flat: 0.35,
    tf: [0.03, 0.25],
    path: [
      ['T', 10, 0.66, 5],
      ['U', 2.2, 0.16, 0.8],
    ],
  },
  {
    id: 'deltoidAnterior',
    group: 'frontDelts',
    r: 2.2,
    tf: [0.05, 0.2],
    path: [
      ['Tsh', 3, 1.5, -3.5],
      ['U', 3, -0.02, 1.2],
      ['U', 1.2, 0.45, 1.6],
    ],
  },
  {
    id: 'deltoidMiddle',
    r: 2.4,
    tf: [0.05, 0.2],
    path: [
      ['Tsh', 0.5, 2.8, 0.5],
      ['U', 0, -0.05, 3.4],
      ['U', 1, 0.45, 1.8],
    ],
  },
  {
    id: 'deltoidPosterior',
    r: 2,
    tf: [0.05, 0.2],
    path: [
      ['Tsh', -5, 1.2, -4],
      ['U', -3, 0, 1.4],
      ['U', 0.6, 0.46, 1.6],
    ],
  },
  {
    id: 'tricepsLong',
    group: 'triceps',
    r: 2.2,
    tf: [0.05, 0.2],
    path: [
      ['Tsh', -1.5, -3, -0.5],
      ['U', -3, 0.6, -0.4],
      ['F', -1.8, -0.06, -0.5],
    ],
  },
  {
    id: 'tricepsLateral',
    group: 'triceps',
    r: 2,
    tf: [0.05, 0.25],
    path: [
      ['U', -1.2, 0.18, 1.4],
      ['U', -2.9, 0.75, 0.8],
      ['F', -1.8, -0.06, -0.4],
    ],
  },
  {
    id: 'tricepsMedial',
    group: 'triceps',
    r: 1.6,
    tf: [0.05, 0.15],
    path: [
      ['U', -1.6, 0.55, -0.8],
      ['F', -1.6, -0.05, -0.6],
    ],
  },
  {
    id: 'bicepsLong',
    r: 2,
    tf: [0.25, 0.15],
    path: [
      ['Tsh', 0.5, 0.5, 0.3],
      ['U', 3.2, 0.5, 0.2],
      ['F', 1, 0.12, 0.9],
    ],
  },
  {
    id: 'bicepsShort',
    r: 1.6,
    tf: [0.15, 0.15],
    path: [
      ['Tsh', 2.5, -1, -2.5],
      ['U', 3, 0.5, -0.4],
      ['F', 1, 0.12, 0.9],
    ],
  },
  {
    id: 'brachialis',
    r: 2,
    tf: [0.05, 0.15],
    path: [
      ['U', 1.4, 0.5, 0],
      ['F', 0.9, 0.1, -0.3],
    ],
  },
  {
    id: 'brachioradialis',
    r: 1.4,
    tf: [0.05, 0.45],
    path: [
      ['U', 0.6, 0.7, 2.4],
      ['F', 0.6, 0.97, 1.9],
    ],
  },
  {
    id: 'forearmFlexors',
    r: 1.8,
    tf: [0.05, 0.45],
    path: [
      ['U', 0, 0.98, -2.8],
      ['F', 1.2, 0.88, -0.6],
    ],
  },
  {
    id: 'forearmExtensors',
    r: 1.6,
    tf: [0.05, 0.45],
    path: [
      ['U', 0, 0.98, 2.4],
      ['F', -1.2, 0.88, 0.8],
    ],
  },
]

// ---------------------------------------------------------------------------

// Постоянные размеры сегментов по первому кадру
export function anatomyDims(body, lift, rigs, frames) {
  const s = rightSide(lift)
  const F0 = frames[0]
  const j = rigs[0].joints
  return {
    k: body.height / 178,
    torso: F0.T.length,
    thigh: body.L.thigh,
    shin: body.L.shin,
    upperArm: body.L.upperArm,
    forearm: body.L.forearm,
    // плечевой сустав в системе торса: в жиме он ниже оси торса
    shoulder: toLocal(F0.T, j[`shoulder${s}`]),
    hip: toLocal(F0.T, j[`hip${s}`]),
    neckBase: toLocal(F0.HD, j.neckBase),
    headBase: toLocal(F0.HD, j.headBase),
    ankleH: body.L.ankleH,
    foot: body.L.foot,
  }
}

const LONG = { TH: 'thigh', SH: 'shin', U: 'upperArm', F: 'forearm' }

// Надколенник: впереди колена, по биссектрисе передних осей бедра и голени
export function patella(Fr, k) {
  const n = norm(addv(Fr.TH.f, Fr.SH.f))
  return addv(addv(Fr.SH.o, scale(n, 4.5 * k)), scale(Fr.TH.up, 1 * k))
}

export function landmark(lm, Fr, D) {
  const [seg, x, y, z] = lm
  const { k } = D
  if (seg === 'P') return patella(Fr, k)
  if (seg === 'T') return toWorld(Fr.T, x * k, y * D.torso, z * k)
  if (seg === 'Tsh') {
    const s = D.shoulder
    return toWorld(Fr.T, s.x + x * k, s.y + y * k, s.z + z * k)
  }
  if (seg === 'FT' || seg === 'HD') return toWorld(Fr[seg], x * k, y * k, z * k)
  return toWorld(Fr[seg], x * k, -y * D[LONG[seg]], z * k)
}

// Мышцы одного кадра: точки пути для правой и левой сторон
export function musclePaths(Fr, D) {
  const out = []
  for (const m of MUSCLES) {
    const right = m.path.map((lm) => landmark(lm, Fr, D))
    out.push({ m, side: 'R', points: right })
    out.push({ m, side: 'L', points: right.map(mirror) })
  }
  return out
}

export function pathLength(points) {
  let s = 0
  for (let i = 1; i < points.length; i++)
    s += len(sub(points[i], points[i - 1]))
  return s
}

// Нагрузка группы в кадре: доля силовых возможностей сустава (может быть
// больше 1 — тогда модель предупреждает о перегрузке) или null.
export function groupLoad(group, util) {
  const g = GROUPS[group]
  return g ? g.drive(util ?? {}) : null
}
