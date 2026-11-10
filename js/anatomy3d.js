// 3D-анатомия: процедурные кости и мышцы-веретёна поверх кадров рига.
// Кости — жёсткие, строятся в локальной системе своего сегмента
// (x вперёд, y вверх, z наружу; см. anatomy.js) и сливаются в одну
// геометрию на сегмент. Мышцы — веретёна между точками прикрепления:
// их положение, поворот, длина и цвет (нагрузка) запекаются в треки.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  anatomyDims,
  anatomyFrames,
  groupLoad,
  musclePaths,
  mirrorFrame,
  patella,
  pathLength,
  rightSide,
} from './anatomy.js'

const COLORS = {
  bone: 0xe9e0cb,
  socket: 0x3b3431,
  tendon: 0xe6dccb,
  idle: 0xbfaaa5, // мышца не моделируется в этом упражнении
  rest: 0xe3c0b6, // моделируется, нагрузки нет
  max: 0xb3121f, // нагрузка ≥ FULL
}
// Нагрузка (доля возможностей сустава), при которой цвет насыщается
export const FULL_LOAD = 1.5

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const UP = V(0, 1, 0)

// ---------------------------------------------------------------------------
// Примитивы. Всё в сантиметрах в локальной системе сегмента.

// Геометрия, построенная вдоль +Y от 0 до длины, ставится на отрезок a→b
function orient(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())
  geo.applyQuaternion(q)
  geo.translate(a.x, a.y, a.z)
  return geo
}

// Стержень: усечённый конус от a (радиус r0) до b (радиус r1)
function rod(a, b, r0, r1 = r0, radial = 12) {
  const h = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r1, r0, h, radial, 1)
  g.translate(0, h / 2, 0)
  return orient(g, a, b)
}

function ball(c, r, sx = 1, sy = 1, sz = 1, seg = 16) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1))
  g.scale(sx, sy, sz)
  g.translate(c.x, c.y, c.z)
  return g
}

// Тело вращения с профилем [[доля длины, радиус], …] вдоль a→b
function lathe(a, b, profile, radial = 14) {
  const h = a.distanceTo(b)
  const pts = [new THREE.Vector2(0, 0)]
  for (const [t, r] of profile) pts.push(new THREE.Vector2(r, t * h))
  pts.push(new THREE.Vector2(0, h))
  return orient(new THREE.LatheGeometry(pts, radial), a, b)
}

function tube(points, r, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed)
  return new THREE.TubeGeometry(curve, points.length * 6, r, 8, closed)
}

// Тонкая треугольная пластина (лопатка)
function plate(p1, p2, p3, thick) {
  const n = new THREE.Vector3()
    .subVectors(p2, p1)
    .cross(new THREE.Vector3().subVectors(p3, p1))
    .normalize()
    .multiplyScalar(thick / 2)
  const pts = [p1, p2, p3].flatMap((p) => [p.clone().add(n), p.clone().sub(n)])
  const g = new THREE.BufferGeometry().setFromPoints(pts)
  // 0,2,4 — верхняя грань; 1,3,5 — нижняя
  g.setIndex([
    0, 2, 4, 1, 5, 3, 0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 1, 4, 1, 0,
  ])
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array(12), 2),
  )
  g.computeVertexNormals()
  return g
}

// Зеркальная копия геометрии относительно плоскости z = 0
function mirrored(geo) {
  const g = geo.clone()
  const p = g.attributes.position
  const n = g.attributes.normal
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, -p.getZ(i))
    n.setZ(i, -n.getZ(i))
  }
  const idx = g.index.array
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1]
    idx[i + 1] = idx[i + 2]
    idx[i + 2] = t
  }
  return g
}

function merge(parts) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p : p.toNonIndexed())))
  for (const p of parts) p.dispose()
  return g
}

// ---------------------------------------------------------------------------
// Кости правой стороны. k — масштаб роста; длины костей — из замеров.

function femur(L, k) {
  const s = (x, y, z) => V(x * k, y * k, z * k)
  const knee = -L
  return merge([
    ball(s(0, 0, 0), 2.4 * k), // головка
    rod(s(0, 0, 0), s(-0.3, -3.2, 4.2), 1.5 * k, 1.7 * k), // шейка
    ball(s(-0.8, -3, 5.2), 2 * k, 1, 1.3, 0.9), // большой вертел
    ball(s(-1.2, -6.5, 2.6), 1 * k), // малый вертел
    lathe(V(-0.3 * k, -4 * k, 4.4 * k), V(0.3 * k, knee + 6 * k, 0.8 * k), [
      [0, 2 * k],
      [0.15, 1.5 * k],
      [0.5, 1.3 * k],
      [0.85, 1.5 * k],
      [1, 2 * k],
    ]),
    rod(
      V(0.3 * k, knee + 6 * k, 0.8 * k),
      V(-0.2 * k, knee + 2 * k, 0),
      2 * k,
      3.4 * k,
    ),
    ball(V(-0.6 * k, knee + 1.6 * k, 2.1 * k), 2.3 * k, 1.3, 1, 0.85), // мыщелки
    ball(V(-0.8 * k, knee + 1.4 * k, -2.2 * k), 2.4 * k, 1.3, 1, 0.85),
  ])
}

function tibiaFibula(L, k) {
  const a = -L
  return merge([
    rod(V(0, -0.9 * k, 0), V(0, -3.5 * k, 0), 3.8 * k, 2.6 * k, 16), // плато
    ball(V(2.6 * k, -6 * k, 0), 0.9 * k), // бугристость
    lathe(V(0.6 * k, -3.5 * k, 0), V(0, a + 3.5 * k, -0.3 * k), [
      [0, 2.4 * k],
      [0.25, 1.6 * k],
      [0.7, 1.3 * k],
      [1, 1.6 * k],
    ]),
    rod(
      V(0, a + 4 * k, -0.3 * k),
      V(0, a + 0.9 * k, -0.4 * k),
      1.6 * k,
      2.3 * k,
    ),
    ball(V(0.2 * k, a + 0.3 * k, -2 * k), 1.1 * k, 1, 1.5, 0.8), // мед. лодыжка
    // малоберцовая
    ball(V(-1.6 * k, -3.2 * k, 3 * k), 1.1 * k),
    rod(
      V(-1.6 * k, -4 * k, 3 * k),
      V(-1 * k, a + 2 * k, 2.6 * k),
      0.6 * k,
      0.6 * k,
      8,
    ),
    ball(V(-0.9 * k, a - 0.2 * k, 2.6 * k), 1 * k, 1, 1.6, 0.8),
  ])
}

function footBones(D) {
  const { k } = D
  const floor = -D.ankleH
  const toe = D.foot * 0.75
  const heel = -D.foot * 0.25
  const parts = [
    ball(V(0.5 * k, -1.2 * k, 0), 2.2 * k, 1.3, 0.8, 1), // таранная
    rod(
      V(-0.5 * k, -2.8 * k, 0.3 * k),
      V(heel + 2 * k, floor + 2.4 * k, 0.4 * k),
      1.9 * k,
      2.2 * k,
    ),
    ball(V(heel + 2 * k, floor + 2.4 * k, 0.4 * k), 2.3 * k), // пяточный бугор
    ball(V(3.5 * k, -2.3 * k, -1.2 * k), 1.3 * k), // ладьевидная
    ball(V(3 * k, -4 * k, 1.5 * k), 1.4 * k), // кубовидная
    ball(V(5.5 * k, -2.8 * k, -0.6 * k), 1.5 * k, 1, 0.9, 1.6), // клиновидные
  ]
  for (let i = 0; i < 5; i++) {
    const z0 = (-1.8 + i * 1.1) * k
    const base = V(6.5 * k, (-3.2 - i * 0.4) * k, z0)
    const head = V(toe - 5 * k, floor + 1.3 * k, z0 * 1.7 - 0.3 * k)
    const r = (i === 0 ? 0.85 : 0.5) * k
    parts.push(rod(base, head, r * 1.1, r))
    parts.push(
      rod(
        head,
        V(toe - (i === 0 ? 0 : 1 + i * 0.6) * k, floor + 0.9 * k, head.z),
        r * 0.9,
        r * 0.75,
        8,
      ),
    )
  }
  return merge(parts)
}

function humerus(L, k) {
  const e = -L
  return merge([
    ball(V(-0.3 * k, 0.2 * k, -0.3 * k), 2.3 * k), // головка
    ball(V(0.6 * k, 0.5 * k, 1.8 * k), 1.2 * k), // большой бугорок
    ball(V(1.8 * k, -0.3 * k, 0.3 * k), 0.8 * k), // малый бугорок
    lathe(V(0, -2 * k, 0.4 * k), V(0, e + 4 * k, 0), [
      [0, 1.5 * k],
      [0.3, 1.1 * k],
      [0.8, 1 * k],
      [1, 1.2 * k],
    ]),
    rod(V(0, e + 5 * k, 0), V(0, e + 1.2 * k, 0), 1.2 * k, 2.2 * k),
    ball(V(0, e + 1 * k, -2.9 * k), 1 * k), // медиальный надмыщелок
    ball(V(0, e + 1 * k, 2.4 * k), 0.8 * k), // латеральный
    rod(V(0.3 * k, e, -2.2 * k), V(0.3 * k, e, 1.8 * k), 1.2 * k), // блок
  ])
}

function forearmBones(D, Lhand) {
  const { k } = D
  const w = -D.forearm
  const parts = [
    ball(V(-1.6 * k, 0.3 * k, -0.6 * k), 1.2 * k, 1, 1.4, 1), // локтевой отросток
    rod(
      V(-1.2 * k, -0.5 * k, -0.7 * k),
      V(-0.4 * k, w + 0.5 * k, -1.6 * k),
      1 * k,
      0.55 * k,
      10,
    ),
    ball(V(-0.4 * k, w + 0.3 * k, -1.6 * k), 0.7 * k),
    rod(V(0.2 * k, -0.6 * k, 1.1 * k), V(0.2 * k, -2 * k, 1.1 * k), 1.1 * k), // головка лучевой
    rod(
      V(0.2 * k, -2 * k, 1.1 * k),
      V(0.3 * k, w + 1.5 * k, 1.6 * k),
      0.65 * k,
      1 * k,
      10,
    ),
    rod(
      V(0.3 * k, w + 1.5 * k, 1.6 * k),
      V(0.2 * k, w, 1.2 * k),
      1 * k,
      1.5 * k,
    ),
    ball(V(0, w - 1.6 * k, 0.3 * k), 1.7 * k, 0.8, 1, 1.4), // запястье
  ]
  // кисть: пястные кости и пальцы, обхватывающие гриф (он на оси, в −Lhand)
  for (let i = 0; i < 4; i++) {
    const z = (-1.8 + i * 1.25) * k
    const base = V(0, w - 3 * k, z * 0.6)
    const knuckle = V(-0.6 * k, -Lhand - 1.5 * k, z)
    parts.push(rod(base, knuckle, 0.5 * k, 0.45 * k, 8))
    const c = V(0, -Lhand, z)
    const r = 2.2 * k
    const arc = []
    for (let a = 0; a <= 4; a++) {
      const ang = -2.3 + a * 0.9
      arc.push(V(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang), z))
    }
    parts.push(tube([knuckle, ...arc], 0.42 * k))
  }
  return merge(parts)
}

// Позвонок: тело, остистый и поперечные отростки
function vertebra(c, tangent, r, h, k) {
  const t = tangent.clone().normalize()
  const back = V(-1, 0, 0).sub(t.clone().multiplyScalar(-t.x)).normalize()
  const a = c.clone().addScaledVector(t, -h / 2)
  const b = c.clone().addScaledVector(t, h / 2)
  const spine = c
    .clone()
    .addScaledVector(back, r + 3 * k)
    .addScaledVector(t, -1.5 * k)
  const side = (sg) =>
    rod(
      c.clone().addScaledVector(back, r * 0.9),
      c
        .clone()
        .addScaledVector(back, r * 1.2)
        .add(V(0, 0, sg * (r + 2 * k))),
      0.35 * k,
      0.3 * k,
      6,
    )
  return [
    rod(a, b, r, r, 12),
    rod(c.clone().addScaledVector(back, r * 0.8), spine, 0.55 * k, 0.4 * k, 6),
    side(1),
    side(-1),
  ]
}

// Торс: таз, крестец, позвоночник, рёбра, грудина, ключицы, лопатки.
// Система торса: начало между тазобедренными суставами, y — к плечам.
function torsoBones(D) {
  const { k } = D
  const Lt = D.torso
  const sh = V(D.shoulder.x, D.shoulder.y, D.shoulder.z)
  const ph = D.hip.z
  const right = []
  const mid = []

  // --- таз, правая половина
  const acetab = new THREE.TorusGeometry(2.8 * k, 0.55 * k, 8, 24)
  acetab.translate(0, 0, ph - 0.3 * k)
  right.push(acetab)
  const wing = new THREE.SphereGeometry(1, 20, 12)
  wing.scale(7.2 * k, 6 * k, 1.1 * k)
  wing.rotateY(-0.5)
  wing.translate(-1.5 * k, 8 * k, 8.5 * k)
  right.push(wing)
  right.push(
    rod(V(0, 1.5 * k, ph), V(-1 * k, 6 * k, ph - 1 * k), 2.2 * k, 2.4 * k),
  )
  const ischium = V(-4 * k, -6.5 * k, 5.5 * k)
  right.push(rod(V(-1.5 * k, -2 * k, ph - 0.5 * k), ischium, 1.6 * k, 1.5 * k))
  right.push(ball(ischium, 1.7 * k))
  const pubis = V(4 * k, -3.8 * k, 1 * k)
  right.push(rod(ischium, pubis.clone().add(V(-0.5 * k, -1.3 * k, 0)), 0.9 * k))
  right.push(rod(V(1.5 * k, -0.5 * k, ph - 1.5 * k), pubis, 1 * k))
  right.push(ball(pubis, 1 * k, 1.2, 2.2, 0.9))
  // --- крестец (по средней линии)
  const sac = lathe(V(-9 * k, -3 * k, 0), V(-6.5 * k, 9.5 * k, 0), [
    [0, 0.6 * k],
    [0.3, 2.2 * k],
    [0.85, 4.8 * k],
    [1, 4.8 * k],
  ])
  sac.scale(1, 1, 1)
  mid.push(sac)

  // --- позвоночник: 5 поясничных + 12 грудных по S-образной кривой
  const spineCurve = new THREE.CatmullRomCurve3([
    V(-6.5 * k, 0.2 * Lt, 0),
    V(-4.8 * k, 0.33 * Lt, 0),
    V(-5.6 * k, 0.46 * Lt, 0),
    V(-7.8 * k, 0.7 * Lt, 0),
    V(-7.2 * k, 0.9 * Lt, 0),
    V(-5.6 * k, 1.02 * Lt, 0),
  ])
  const vert = []
  for (let i = 0; i < 17; i++) {
    const u = (i + 0.5) / 17
    const c = spineCurve.getPointAt(u)
    const t = spineCurve.getTangentAt(u)
    const r = (i < 5 ? 2.1 : 1.6 - (i - 5) * 0.03) * k
    const h = (Lt * 0.82) / 17 - 0.6 * k
    vert.push({ c, t, r })
    mid.push(...vertebra(c, t, r, h, k))
  }

  // --- рёбра: 12 пар, спереди опускаются; нижние не доходят до грудины
  const widths = [6.5, 9.5, 11.5, 12.8, 13.5, 13.8, 13.8, 13.5, 13, 12.5, 11, 9]
  for (let i = 0; i < 12; i++) {
    const v = vert[16 - i] // T1 сверху
    const xv = v.c.x - 1 * k
    const yv = v.c.y
    const xs = (i < 7 ? 9.6 : 8.5 - (i - 7) * 1.5) * k
    const a = widths[i] * k
    const drop = (3 + i * 0.6) * k
    const end = i < 7 ? 0 : i < 10 ? 0.45 : 1.3 // где ребро кончается спереди
    const cx = (xv + xs) / 2
    const bd = (xs - xv) / 2
    const pts = []
    for (let s = 0; s <= 8; s++) {
      const th = Math.PI - (s / 8) * (Math.PI - end)
      pts.push(
        V(
          cx + bd * Math.cos(th),
          yv - (drop * (1 - Math.cos(th))) / 2,
          1.3 * k + a * Math.sin(th),
        ),
      )
    }
    right.push(tube(pts, (i === 0 ? 0.55 : 0.42) * k))
  }
  // грудина
  mid.push(
    rod(
      V(9.8 * k, 0.66 * Lt, 0),
      V(9.6 * k, 0.94 * Lt, 0),
      1.2 * k,
      1.8 * k,
      10,
    ).scale(1, 1, 1.4),
  )

  // --- ключица и лопатка
  const stern = V(9.3 * k, 0.95 * Lt, 1.8 * k)
  const acromion = sh.clone().add(V(-0.5 * k, 2.8 * k, -0.5 * k))
  right.push(
    tube(
      [
        stern,
        V(8.5 * k, 0.97 * Lt, (sh.z + 1.8 * k) * 0.4),
        V(2 * k, sh.y + 2.6 * k, sh.z - 5 * k),
        acromion,
      ],
      0.75 * k,
    ),
  )
  const S = (x, y, z) => sh.clone().add(V(x * k, y * k, z * k))
  right.push(
    plate(S(-8.5, 1.5, -9.5), S(-9.5, -14, -8), S(-3, -2, -2.5), 0.6 * k),
  )
  right.push(
    tube([S(-9.5, -1, -9.5), S(-5, 1.5, -5), S(-2, 2.8, -0.5)], 0.6 * k),
  )
  right.push(tube([S(-2, 0.5, -3), S(1, 0.5, -3), S(2.5, -0.5, -2.8)], 0.5 * k))
  right.push(ball(S(-1.6, 0, -1.4), 1.6 * k, 0.6, 1.2, 1)) // суставная впадина

  const half = merge(right)
  return merge([half, mirrored(half), ...mid])
}

// Череп и шейный отдел в системе головы (начало в центре головы)
function skull(D) {
  const { k } = D
  const parts = [
    ball(V(-1 * k, 1.5 * k, 0), 1, 9 * k, 8.2 * k, 7.3 * k, 28),
    ball(V(4.6 * k, -3 * k, 0), 1, 4 * k, 4.4 * k, 5.4 * k, 20), // лицевой отдел
  ]
  const jaw = [
    V(-1.2 * k, -4 * k, 5.4 * k),
    V(-1 * k, -8.6 * k, 4.8 * k),
    V(5.5 * k, -10 * k, 2.6 * k),
    V(7.2 * k, -10.3 * k, 0),
  ]
  const jawR = tube(jaw, 0.9 * k)
  parts.push(jawR, mirrored(jawR))
  // шейные позвонки — от основания шеи до основания черепа
  const a = V(D.neckBase.x - 1.5 * k, D.neckBase.y, 0)
  const b = V(D.headBase.x - 2 * k, D.headBase.y - 1 * k, 0)
  const t = b.clone().sub(a)
  for (let i = 0; i < 6; i++) {
    const c = a.clone().addScaledVector(t, (i + 0.5) / 6)
    parts.push(...vertebra(c, t, 1.3 * k, t.length() / 6 - 0.5 * k, k * 0.8))
  }
  return merge(parts)
}

// Глазницы — тёмные впадины, отдельным материалом
function orbits(k) {
  return merge([
    ball(V(7.4 * k, -0.6 * k, 3.1 * k), 1.8 * k),
    ball(V(7.4 * k, -0.6 * k, -3.1 * k), 1.8 * k),
    ball(V(8.6 * k, -4 * k, 0), 1, 0.8 * k, 1.4 * k, 1 * k), // нос
  ])
}

// ---------------------------------------------------------------------------
// Мышца: веретено вдоль +Y от 0 до 1 с сухожилиями на концах.
// g0..g1 — какую часть всей мышцы занимает этот кусок пути.
function spindle(g0, g1, tf0, tf1, tendonR) {
  const pts = [new THREE.Vector2(0, 0)]
  const n = 16
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const g = g0 + (g1 - g0) * t
    const u = (g - tf0) / (1 - tf0 - tf1)
    const belly = u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 0.7 : 0
    pts.push(new THREE.Vector2(tendonR + (1 - tendonR) * belly, t))
  }
  pts.push(new THREE.Vector2(0, 1))
  return new THREE.LatheGeometry(pts, 14)
}

const _c = new THREE.Color()
const _lo = new THREE.Color(COLORS.rest)
const _hi = new THREE.Color(COLORS.max)
export function loadColor(load, out = _c) {
  if (load === null) return out.set(COLORS.idle)
  const a = Math.min(1, Math.max(0, load / FULL_LOAD)) ** 0.8
  return out.copy(_lo).lerp(_hi, a)
}

// Базис куска мышцы: y — вдоль, x — нормаль сплющенности (наружу от оси
// торса), чтобы широкие мышцы лежали на теле, а не торчали ребром.
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
function pieceQuaternion(a, b, outward, q) {
  _y.subVectors(b, a).normalize()
  _x.copy(outward).addScaledVector(_y, -outward.dot(_y))
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0).addScaledVector(_y, -_y.x)
  _x.normalize()
  _z.crossVectors(_x, _y)
  _m.makeBasis(_x, _y, _z)
  return q.setFromRotationMatrix(_m)
}

// ---------------------------------------------------------------------------

// Построить анатомию и треки. rigs — кадры в порядке проигрывания,
// utils — нагрузки суставов для тех же кадров.
export function buildAnatomy(body, lift, rigs, utils) {
  const frames = anatomyFrames(lift, rigs)
  const D = anatomyDims(body, lift, rigs, frames)
  const { k } = D
  const group = new THREE.Group()
  group.name = 'anatomy'
  const tracks = []
  const n = rigs.length
  const times = (duration) => rigs.map((_, i) => (i / (n - 1)) * duration)

  const boneMat = new THREE.MeshStandardMaterial({
    color: COLORS.bone,
    roughness: 0.55,
  })
  const socketMat = new THREE.MeshStandardMaterial({
    color: COLORS.socket,
    roughness: 0.9,
  })

  // --- кости: группа на сегмент, её поза — система координат сегмента
  const boneSets = []
  const addBones = (name, geo, frameOf, extra = []) => {
    const g = new THREE.Group()
    g.name = name
    const mesh = new THREE.Mesh(geo, boneMat)
    mesh.castShadow = true
    g.add(mesh, ...extra)
    group.add(g)
    boneSets.push({ name, frameOf })
  }
  const s = rightSide(lift)
  const j0 = rigs[0].joints
  const handLen = Math.hypot(
    j0[`hand${s}`].x - j0[`elbow${s}`].x,
    j0[`hand${s}`].y - j0[`elbow${s}`].y,
    j0[`hand${s}`].z - j0[`elbow${s}`].z,
  )
  const limb = {
    TH: femur(D.thigh, k),
    SH: tibiaFibula(D.shin, k),
    FT: footBones(D),
    U: humerus(D.upperArm, k),
    F: forearmBones(D, handLen),
  }
  for (const [seg, geo] of Object.entries(limb)) {
    addBones(`ana_${seg}_R`, geo, (Fr) => Fr[seg])
    addBones(`ana_${seg}_L`, mirrored(geo), (Fr) => mirrorFrame(Fr[seg]))
  }
  addBones('ana_T', torsoBones(D), (Fr) => Fr.T)
  addBones('ana_HD', skull(D), (Fr) => Fr.HD, [
    new THREE.Mesh(orbits(k), socketMat),
  ])
  // надколенники: положение по бедру и голени, поворот — как у голени
  const patGeo = ball(V(0, 0, 0), 2.2 * k, 0.6, 1.1, 1)
  for (const side of ['R', 'L']) {
    const m = new THREE.Mesh(patGeo, boneMat)
    m.name = `ana_PT_${side}`
    group.add(m)
  }

  const t = (dur) => times(dur)
  const q = new THREE.Quaternion()
  const basis = (F) => {
    _m.makeBasis(
      _x.set(F.f.x, F.f.y, F.f.z),
      _y.set(F.up.x, F.up.y, F.up.z),
      _z.set(F.lat.x, F.lat.y, F.lat.z),
    )
    return q.setFromRotationMatrix(_m)
  }
  const boneTracks = (duration) => {
    const out = []
    for (const { name, frameOf } of boneSets) {
      const pos = []
      const rot = []
      for (const Fr of frames) {
        const F = frameOf(Fr)
        pos.push(F.o.x, F.o.y, F.o.z)
        basis(F)
        rot.push(q.x, q.y, q.z, q.w)
      }
      out.push(
        new THREE.VectorKeyframeTrack(`${name}.position`, t(duration), pos),
      )
      out.push(
        new THREE.QuaternionKeyframeTrack(
          `${name}.quaternion`,
          t(duration),
          rot,
        ),
      )
    }
    for (const side of ['R', 'L']) {
      const pos = []
      const rot = []
      for (const Fr of frames) {
        const p = patella(Fr, k)
        const F = side === 'R' ? Fr.SH : mirrorFrame(Fr.SH)
        const pp = side === 'R' ? p : { x: p.x, y: p.y, z: -p.z }
        pos.push(pp.x, pp.y, pp.z)
        basis(F)
        rot.push(q.x, q.y, q.z, q.w)
      }
      out.push(
        new THREE.VectorKeyframeTrack(
          `ana_PT_${side}.position`,
          t(duration),
          pos,
        ),
      )
      out.push(
        new THREE.QuaternionKeyframeTrack(
          `ana_PT_${side}.quaternion`,
          t(duration),
          rot,
        ),
      )
    }
    return out
  }

  // --- мышцы
  const perFrame = frames.map((Fr) => musclePaths(Fr, D))
  const loads = utils.map((u) => {
    const out = {}
    for (const m of perFrame[0]) out[m.m.group] ??= groupLoad(m.m.group, u)
    return out
  })
  const pieces = []
  const tendonMat = new THREE.MeshStandardMaterial({
    color: COLORS.tendon,
    roughness: 0.4,
  })
  perFrame[0].forEach((entry, mi) => {
    const { m, side } = entry
    const restLens = perFrame.map((p) => pathLength(p[mi].points))
    const rest = [...restLens].sort((a, b) => a - b)[restLens.length >> 1]
    const mat = m.tendon
      ? tendonMat
      : new THREE.MeshStandardMaterial({ roughness: 0.5, color: COLORS.rest })
    if (!m.tendon) loadColor(loads[0][m.group] ?? null, mat.color)
    // доли кусков по длине в покое
    const pts0 = entry.points
    const segLens = pts0.slice(1).map((p, i) => {
      const a = pts0[i]
      return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z)
    })
    const total = segLens.reduce((a, b) => a + b, 0)
    let acc = 0
    segLens.forEach((l, pi) => {
      const g0 = acc / total
      acc += l
      const g1 = acc / total
      const geo = m.tendon
        ? new THREE.CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0)
        : spindle(g0, g1, m.tf?.[0] ?? 0.1, m.tf?.[1] ?? 0.1, 0.2)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.name = `mus_${m.id}_${side}_${pi}`
      mesh.castShadow = true
      group.add(mesh)
      pieces.push({
        mesh,
        mi,
        pi,
        m,
        rest,
        colorTrack: pi === 0 && !m.tendon,
      })
    })
  })

  const muscleTracks = (duration) => {
    const out = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const outward = new THREE.Vector3()
    const upv = new THREE.Vector3()
    const qq = new THREE.Quaternion()
    for (const pc of pieces) {
      const pos = []
      const rot = []
      const scl = []
      const col = []
      perFrame.forEach((paths, fi) => {
        const { points } = paths[pc.mi]
        const P = points[pc.pi]
        const Q = points[pc.pi + 1]
        a.set(P.x, P.y, P.z)
        b.set(Q.x, Q.y, Q.z)
        // наружу от оси торса, на уровне середины куска
        const T = frames[fi].T
        const mid = a.clone().add(b).multiplyScalar(0.5)
        upv.set(T.up.x, T.up.y, T.up.z)
        const along = mid.clone().sub(T.o).dot(upv)
        outward
          .copy(mid)
          .sub(V(T.o.x, T.o.y, T.o.z).addScaledVector(upv, along))
        pieceQuaternion(a, b, outward, qq)
        pos.push(a.x, a.y, a.z)
        rot.push(qq.x, qq.y, qq.z, qq.w)
        // объём мышцы сохраняется: короче — толще
        const vol = pc.m.tendon
          ? 1
          : Math.min(
              1.3,
              Math.max(0.8, Math.sqrt(pc.rest / pathLength(points))),
            )
        const r = pc.m.r * k * vol
        scl.push(r * (pc.m.flat ?? 1), a.distanceTo(b), r)
        if (pc.colorTrack) {
          loadColor(loads[fi][pc.m.group] ?? null, _c)
          col.push(_c.r, _c.g, _c.b)
        }
      })
      const nm = pc.mesh.name
      out.push(
        new THREE.VectorKeyframeTrack(`${nm}.position`, t(duration), pos),
      )
      out.push(
        new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, t(duration), rot),
      )
      out.push(new THREE.VectorKeyframeTrack(`${nm}.scale`, t(duration), scl))
      if (pc.colorTrack && pc.m.group && hasLoad(loads, pc.m.group)) {
        out.push(
          new THREE.ColorKeyframeTrack(
            `${nm}.material.color`,
            t(duration),
            col,
          ),
        )
      }
    }
    return out
  }

  return {
    group,
    loads,
    tracks: (duration) => [...boneTracks(duration), ...muscleTracks(duration)],
  }
}

function hasLoad(loads, group) {
  return loads.some((l) => l[group] !== null && l[group] !== undefined)
}
