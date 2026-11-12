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
  // скуловая дуга, скула и сосцевидный отросток
  const cheek = merge([
    tube(
      [V(6.6 * k, -2.4 * k, 4.6 * k), V(3 * k, -2.6 * k, 6.1 * k), V(-0.5 * k, -2.8 * k, 6 * k)],
      0.6 * k,
    ),
    ball(V(6.8 * k, -2.6 * k, 4.4 * k), 1.4 * k, 1, 0.9, 0.8),
    ball(V(-1.4 * k, -5 * k, 5 * k), 1 * k, 0.9, 1.4, 0.8),
  ])
  parts.push(jawR, mirrored(jawR), cheek, mirrored(cheek))
  // надбровье и ряды зубов
  const arc = (y, x0, depth, w) =>
    [-1, -0.5, 0, 0.5, 1].map((t) =>
      V((x0 - depth * t * t) * k, y * k, t * w * k),
    )
  parts.push(tube(arc(1.2, 8.6, 1.4, 4.2), 0.8 * k))
  parts.push(tube(arc(-6.3, 8, 2.8, 2.6), 0.55 * k))
  parts.push(tube(arc(-7.4, 7.9, 2.8, 2.5), 0.5 * k))
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
// Мышцы — гладкие трубки вдоль сплайна через точки пути. Сечение —
// эллипс: широкий вдоль поверхности тела и тонкий по нормали к ней, с
// плоской внутренней стороной, которой мышца лежит на кости. Вершины
// пересчитываются в каждом кадре, все мышцы — одна геометрия.
const RINGS = 28
const SIDES = 14
const INNER = 0.55 // толщина внутренней стороны относительно наружной

const _c = new THREE.Color()
const _lo = new THREE.Color(COLORS.rest)
const _hi = new THREE.Color(COLORS.max)
export function loadColor(load, out = _c) {
  if (load === null) return out.set(COLORS.idle)
  const a = Math.min(1, Math.max(0, load / FULL_LOAD)) ** 0.8
  return out.copy(_lo).lerp(_hi, a)
}

// Радиус по длине мышцы g ∈ [0, 1]: сухожилия на концах, брюшко между
// ними. Широкие плоские мышцы переходят в апоневроз, а не в шнур.
function profile(m, g) {
  const cap = Math.min(1, g / 0.025, (1 - g) / 0.025) ** 0.5
  if (m.tendon) return { rad: cap, belly: 0 }
  const [t0, t1] = m.tf ?? [0.1, 0.1]
  const flat = (m.flat ?? 1) < 0.5
  const tr = flat ? 0.5 : 0.24
  const u = (g - t0) / (1 - t0 - t1)
  const belly =
    u > 0 && u < 1 ? Math.sin(Math.PI * u) ** (flat ? 0.35 : 0.6) : 0
  return { rad: (tr + (1 - tr) * belly) * cap, belly }
}

// Текстура пучков волокон: полосы вдоль мышцы (по u) с бороздами между
// пучками. Серая — умножается на цвет нагрузки; она же служит рельефом.
function fiberTexture() {
  if (typeof document === 'undefined') return null
  const w = 256
  const h = 64
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(w, h)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const col = []
  let v = 0.9
  let next = 0
  for (let x = 0; x < w; x++) {
    v = 0.8 * v + 0.2 * (0.78 + rnd() * 0.22)
    if (x >= next) next = x + 5 + Math.floor(rnd() * 7) // граница пучка
    const groove = x === next - 1 ? 0.7 : x === next - 2 ? 0.88 : 1
    col.push(v * groove)
  }
  for (let y = 0; y < h; y++) {
    const ripple = 0.97 + 0.03 * Math.sin((y / h) * Math.PI * 6)
    for (let x = 0; x < w; x++) {
      const b = Math.round(255 * Math.min(1, col[x] * ripple + 0.1))
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

// Отрезки осей костей (правая сторона) — от них считается «наружу»
function boneAxes(Fr, D) {
  const P = (o) => V(o.x, o.y, o.z)
  const along = (F, l) => P(F.o).addScaledVector(P(F.up), -l)
  const T0 = P(Fr.T.o)
  return [
    [T0, T0.clone().addScaledVector(P(Fr.T.up), D.torso * 1.15)],
    [P(Fr.TH.o), along(Fr.TH, D.thigh)],
    [P(Fr.SH.o), along(Fr.SH, D.shin)],
    [P(Fr.FT.o), P(Fr.FT.o).addScaledVector(P(Fr.FT.f), D.foot * 0.6)],
    [P(Fr.U.o), along(Fr.U, D.upperArm)],
    [P(Fr.F.o), along(Fr.F, D.forearm)],
  ]
}

const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _d = new THREE.Vector3()
const _q = new THREE.Vector3()
// Направление «наружу» в точке c: от ближайших осей костей, с плавным
// весом, чтобы сечение не перекручивалось при смене ближайшей кости
function outwardAt(c, axes, out) {
  out.set(0, 0, 0)
  for (const [a, b] of axes) {
    _d.subVectors(b, a)
    const t = Math.min(
      1,
      Math.max(0, _q.subVectors(c, a).dot(_d) / _d.lengthSq()),
    )
    _q.copy(a).addScaledVector(_d, t)
    _d.subVectors(c, _q)
    const r = _d.length() || 1e-3
    out.addScaledVector(_d, 1 / (r * (r * r * r * r + 1e-3)))
  }
  return out.normalize()
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
    roughness: 0.68,
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
  const axesPerFrame = frames.map((Fr) => boneAxes(Fr, D))
  const loads = utils.map((u) => {
    const out = {}
    for (const m of perFrame[0]) out[m.m.group] ??= groupLoad(m.m.group, u)
    return out
  })
  // Правые мышцы: левые получаются зеркалом (z → −z) при записи вершин
  const items = []
  perFrame[0].forEach((entry, mi) => {
    if (entry.side !== 'R') return
    const { m } = entry
    const lens = perFrame.map((p) => pathLength(p[mi].points))
      .sort((a, b) => a - b)
    const rest = lens[lens.length >> 1]
    const rings = []
    for (let i = 0; i <= RINGS; i++) rings.push(profile(m, i / RINGS))
    items.push({
      m,
      mi,
      rest,
      rings,
      curve: new THREE.CatmullRomCurve3(
        entry.points.map((p) => V(p.x, p.y, p.z)),
        false,
        'centripetal',
      ),
    })
  })

  const ringV = SIDES + 1
  const perMuscle = (RINGS + 1) * ringV
  const nV = items.length * 2 * perMuscle
  const position = new Float32Array(nV * 3)
  const normal = new Float32Array(nV * 3)
  const color = new Float32Array(nV * 3)
  const uv = new Float32Array(nV * 2)
  const index = []
  items.forEach((it, n) => {
    for (const mirror of [false, true]) {
      const base = (n * 2 + (mirror ? 1 : 0)) * perMuscle
      for (let i = 0; i <= RINGS; i++) {
        for (let j = 0; j <= SIDES; j++) {
          const v = base + i * ringV + j
          uv[v * 2] = (j / SIDES) * 1.5
          uv[v * 2 + 1] = ((i / RINGS) * it.rest) / 12
          if (i === RINGS || j === SIDES) continue
          const a = v
          const b = v + ringV
          const c = v + ringV + 1
          const d = v + 1
          // зеркальная копия выворачивает обход треугольников
          if (mirror) index.push(a, b, c, a, c, d)
          else index.push(a, c, b, a, d, c)
        }
      }
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(index)
  const fibers = fiberTexture()
  const muscleMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0,
    map: fibers,
    bumpMap: fibers,
    bumpScale: 1.2,
  })
  const muscles = new THREE.Mesh(geo, muscleMat)
  muscles.name = 'muscles'
  muscles.castShadow = true
  muscles.frustumCulled = false // вершины двигаются, сфера границ устаревает
  group.add(muscles)

  const tendonC = new THREE.Color(COLORS.tendon)
  const mc = new THREE.Color()
  const vc = new THREE.Color()
  const P = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const N = new THREE.Vector3()
  const B = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const axes = axesPerFrame[0].map(([a, b]) => [a.clone(), b.clone()])
  let last = null

  // phase ∈ [0, 1] — та же доля проигрыша, что у треков костей
  const update = (phase) => {
    if (phase === last) return
    last = phase
    const u = Math.min(1, Math.max(0, phase)) * (n - 1)
    const i0 = Math.min(n - 2, Math.floor(u))
    const f = n > 1 ? u - i0 : 0
    const i1 = Math.min(n - 1, i0 + 1)
    axes.forEach(([a, b], ai) => {
      a.lerpVectors(axesPerFrame[i0][ai][0], axesPerFrame[i1][ai][0], f)
      b.lerpVectors(axesPerFrame[i0][ai][1], axesPerFrame[i1][ai][1], f)
    })
    items.forEach((it, idx) => {
      const p0 = perFrame[i0][it.mi].points
      const p1 = perFrame[i1][it.mi].points
      it.curve.points.forEach((p, j) =>
        p.set(
          p0[j].x + (p1[j].x - p0[j].x) * f,
          p0[j].y + (p1[j].y - p0[j].y) * f,
          p0[j].z + (p1[j].z - p0[j].z) * f,
        ),
      )
      it.curve.updateArcLengths()
      const len = it.curve.getLength()
      const { m } = it
      // объём сохраняется: короче — толще
      const vol = m.tendon
        ? 1
        : Math.min(1.3, Math.max(0.8, Math.sqrt(it.rest / len)))
      const R = m.r * k * vol
      const flat = m.flat ?? 1
      const l0 = loads[i0][m.group] ?? null
      const l1 = loads[i1][m.group] ?? null
      loadColor(l0 === null || l1 === null ? l0 : l0 + (l1 - l0) * f, mc)
      for (let i = 0; i <= RINGS; i++) {
        const g = i / RINGS
        const { rad, belly } = it.rings[i]
        it.curve.getPointAt(g, P)
        it.curve.getTangentAt(g, tan)
        outwardAt(P, axes, N)
        N.addScaledVector(tan, -N.dot(tan))
        if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(tan, -tan.x)
        N.normalize()
        B.crossVectors(tan, N)
        // плоские мышцы шире, чтобы соседние пучки смыкались в пласт
        const rb = R * rad * (flat < 0.5 ? 1.3 : 1)
        const ro = R * rad * flat
        if (m.tendon) vc.copy(tendonC)
        else {
          // сухожильные перемычки (у прямой мышцы живота)
          const band = (m.bands ?? []).some((b) => Math.abs(g - b) < 0.02)
          vc.copy(mc).lerp(tendonC, band ? 0.8 : (1 - belly) ** 2 * 0.85)
        }
        for (let j = 0; j <= SIDES; j++) {
          const th = (j / SIDES) * Math.PI * 2
          const cs = Math.cos(th)
          const sn = Math.sin(th)
          const rn = cs > 0 ? ro : ro * INNER
          const x = P.x + N.x * rn * cs + B.x * rb * sn
          const y = P.y + N.y * rn * cs + B.y * rb * sn
          const z = P.z + N.z * rn * cs + B.z * rb * sn
          nrm
            .copy(N)
            .multiplyScalar(cs / (rn || 1e-3))
            .addScaledVector(B, sn / (rb || 1e-3))
            .normalize()
          const vR = (idx * 2 * perMuscle + i * ringV + j) * 3
          const vL = vR + perMuscle * 3
          position[vR] = x
          position[vR + 1] = y
          position[vR + 2] = z
          position[vL] = x
          position[vL + 1] = y
          position[vL + 2] = -z
          normal[vR] = nrm.x
          normal[vR + 1] = nrm.y
          normal[vR + 2] = nrm.z
          normal[vL] = nrm.x
          normal[vL + 1] = nrm.y
          normal[vL + 2] = -nrm.z
          color[vR] = color[vL] = vc.r
          color[vR + 1] = color[vL + 1] = vc.g
          color[vR + 2] = color[vL + 2] = vc.b
        }
      }
    })
    geo.attributes.position.needsUpdate = true
    geo.attributes.normal.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }
  update(0)

  return {
    group,
    loads,
    update,
    tracks: (duration) => boneTracks(duration),
  }
}
