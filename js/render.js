// Отрисовка сцены на canvas: вид сбоку, для жима — ещё вид с головы.
import { CONSTANTS } from './solver.js'

const { PLATE_R, BAR_R, BENCH_TOP } = CONSTANTS

export const COLORS = {
  ink: '#1b2430',
  muted: '#5a6573',
  line: '#c9ced4',
  flesh: '#d5dbe2',
  red: '#c42530',
  blue: '#1f4fb5',
  yellow: '#d49a00',
  green: '#2b8655',
}

const FONT = '12px "Golos Text", system-ui, sans-serif'

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

function makeView(width, height, b, pad = 24) {
  const k = Math.min(
    (width - 2 * pad) / (b.x1 - b.x0),
    (height - 2 * pad) / (b.y1 - b.y0),
  )
  const ox = (width - (b.x1 - b.x0) * k) / 2 - b.x0 * k
  const oy = height - pad + b.y0 * k
  return {
    k,
    X: (x) => ox + x * k,
    Y: (y) => oy - y * k,
    P: (p) => [ox + p.x * k, oy - p.y * k],
  }
}

function capsule(ctx, v, p, q, widthCm, color = COLORS.flesh) {
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(4, widthCm * v.k)
  ctx.beginPath()
  ctx.moveTo(...v.P(p))
  ctx.lineTo(...v.P(q))
  ctx.stroke()
}

function bone(ctx, v, pts) {
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(...v.P(p)) : ctx.moveTo(...v.P(p))))
  ctx.stroke()
}

function joint(ctx, v, p, color, r = 6) {
  ctx.fillStyle = color
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(...v.P(p), r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function head(ctx, v, c, rCm) {
  ctx.fillStyle = COLORS.flesh
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(...v.P(c), rCm * v.k, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function plate(ctx, v, B) {
  const [x, y] = v.P(B)
  ctx.fillStyle = 'rgba(196, 37, 48, 0.14)'
  ctx.strokeStyle = COLORS.red
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, PLATE_R * v.k, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, PLATE_R * 0.25 * v.k, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = COLORS.ink
  ctx.beginPath()
  ctx.arc(x, y, Math.max(3, BAR_R * v.k), 0, Math.PI * 2)
  ctx.fill()
}

function barPath(ctx, v, frames) {
  ctx.strokeStyle = COLORS.green
  ctx.setLineDash([3, 4])
  ctx.lineWidth = 1.5
  ctx.beginPath()
  frames.forEach((f, i) =>
    i ? ctx.lineTo(...v.P(f.bar)) : ctx.moveTo(...v.P(f.bar)),
  )
  ctx.stroke()
  ctx.setLineDash([])
}

function floor(ctx, v, x0, x1) {
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(v.X(x0), v.Y(0))
  ctx.lineTo(v.X(x1), v.Y(0))
  ctx.stroke()
}

function label(ctx, text, x, y, color = COLORS.ink, align = 'left') {
  ctx.font = FONT
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width
  const bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(bx - 3, y - 8, w + 6, 16)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

// Плечо рычага: горизонталь от сустава до вертикали через гриф
function leverArm(ctx, v, J, barX, color) {
  const d = barX - J.x
  if (Math.abs(d) < 0.5) return
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(v.X(J.x), v.Y(J.y))
  ctx.lineTo(v.X(barX), v.Y(J.y))
  ctx.stroke()
  ctx.setLineDash([])
  const text = `${Math.abs(d).toFixed(0)} см`
  const mid = v.X((J.x + barX) / 2)
  label(ctx, text, mid, v.Y(J.y) - 12, color, 'center')
}

function lineOfAction(ctx, v, x, yTop) {
  ctx.strokeStyle = 'rgba(27, 36, 48, 0.35)'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(v.X(x), v.Y(0))
  ctx.lineTo(v.X(x), v.Y(yTop))
  ctx.stroke()
  ctx.setLineDash([])
}

function balanceMark(ctx, v, comX) {
  // середина стопы и проекция общего центра масс
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(v.X(0), v.Y(0) + 4)
  ctx.lineTo(v.X(0), v.Y(0) + 12)
  ctx.stroke()
  const x = v.X(comX)
  const y = v.Y(0) + 4
  ctx.fillStyle = COLORS.green
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 6, y + 10)
  ctx.lineTo(x + 6, y + 10)
  ctx.closePath()
  ctx.fill()
}

// ---------------------------------------------------------------------------

function drawStanding(ctx, v, body, res, f, opts) {
  const p = f.pose
  const L = body.L
  const u = { x: Math.sin(p.phi), y: Math.cos(p.phi) }
  const headC = {
    x: p.S.x + u.x * L.headNeck * 0.6,
    y: p.S.y + u.y * L.headNeck * 0.6,
  }

  let elbow
  let hand
  if (res.lift === 'squat') {
    // Кисти на грифе разведены в стороны, поэтому в боковой проекции рука
    // укорочена: локоть рисуем назад-вниз от кисти, вдоль оси торса.
    const n = { x: -Math.cos(p.phi), y: Math.sin(p.phi) }
    hand = { x: p.B.x + n.x * 1.5, y: p.B.y + n.y * 1.5 }
    elbow = {
      x: hand.x + n.x * L.forearm * 0.45 - u.x * L.forearm * 0.55,
      y: hand.y + n.y * L.forearm * 0.45 - u.y * L.forearm * 0.55,
    }
  } else {
    hand = p.B
    elbow = {
      x: p.S.x + (p.B.x - p.S.x) * 0.52,
      y: p.S.y + (p.B.y - p.S.y) * 0.52,
    }
  }

  barPath(ctx, v, res.frames)
  if (opts.showArms) lineOfAction(ctx, v, p.B.x, Math.max(p.B.y, p.S.y) + 10)

  // силуэт
  capsule(ctx, v, p.heel, p.toe, 6)
  capsule(ctx, v, p.A, p.K, 10)
  capsule(ctx, v, p.K, p.H, 15)
  capsule(ctx, v, p.H, p.S, 22)
  capsule(ctx, v, p.S, elbow, 9)
  capsule(ctx, v, elbow, hand, 7)
  head(ctx, v, headC, body.height * 0.058)

  // скелет
  bone(ctx, v, [p.heel, p.toe])
  bone(ctx, v, [p.toe, p.A, p.heel])
  bone(ctx, v, [p.A, p.K, p.H, p.S])
  bone(ctx, v, [p.S, elbow, hand])

  if (res.lift === 'deadlift' || res.lift === 'squat') plate(ctx, v, p.B)

  if (opts.showArms) {
    leverArm(ctx, v, p.H, p.B.x, COLORS.red)
    leverArm(ctx, v, p.K, p.B.x, COLORS.blue)
  }
  joint(ctx, v, p.H, COLORS.red)
  joint(ctx, v, p.K, COLORS.blue)
  joint(ctx, v, p.A, COLORS.yellow)
  joint(ctx, v, p.S, COLORS.ink, 4)
  balanceMark(ctx, v, p.mom.comX)
}

function drawBench(ctx, v, body, res, f, opts) {
  const p = f.pose
  const L = body.L
  const g = res.geo
  const hip = { x: -L.torso, y: BENCH_TOP + 9 }
  const kneeAng = (28 * Math.PI) / 180
  const knee = {
    x: hip.x - L.thigh * Math.cos(kneeAng),
    y: hip.y - L.thigh * Math.sin(kneeAng),
  }
  const drop = knee.y - L.ankleH
  const ankle = {
    x: knee.x + Math.sqrt(Math.max(0, L.shin * L.shin - drop * drop)),
    y: L.ankleH,
  }
  const toe = { x: ankle.x - L.foot * 0.75, y: 0 }
  const heel = { x: ankle.x + L.foot * 0.25, y: 0 }

  // скамья
  ctx.fillStyle = COLORS.line
  ctx.fillRect(
    v.X(-L.torso - 18),
    v.Y(BENCH_TOP),
    (L.torso + 48) * v.k,
    6 * v.k,
  )
  ctx.fillRect(
    v.X(-L.torso),
    v.Y(BENCH_TOP - 6),
    5 * v.k,
    (BENCH_TOP - 6) * v.k,
  )
  ctx.fillRect(v.X(18), v.Y(BENCH_TOP - 6), 5 * v.k, (BENCH_TOP - 6) * v.k)

  barPath(ctx, v, res.frames)
  if (opts.showArms) lineOfAction(ctx, v, p.B.x, p.B.y + 8)

  // торс с прогибом: дуга от плеча к тазу через приподнятую грудь
  // контрольная точка кривой так, чтобы верх груди (центр + 10 см
  // толщины силуэта) пришёлся на точку касания грифа
  const apex = g.yChest - 10
  const chest = { x: res.summary.touchX, y: (4 * apex - p.S.y - hip.y) / 2 }
  ctx.strokeStyle = COLORS.flesh
  ctx.lineWidth = Math.max(6, 20 * v.k)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(...v.P(p.S))
  ctx.quadraticCurveTo(...v.P(chest), ...v.P(hip))
  ctx.stroke()
  capsule(ctx, v, hip, knee, 15)
  capsule(ctx, v, knee, ankle, 10)
  capsule(ctx, v, heel, toe, 6)
  capsule(ctx, v, p.S, p.E, 9)
  capsule(ctx, v, p.E, p.B, 7)
  head(ctx, v, { x: p.S.x + 14, y: p.S.y + 2 }, body.height * 0.058)

  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(...v.P(p.S))
  ctx.quadraticCurveTo(...v.P(chest), ...v.P(hip))
  ctx.stroke()
  bone(ctx, v, [hip, knee, ankle])
  bone(ctx, v, [heel, toe])
  bone(ctx, v, [p.S, p.E, p.B])

  plate(ctx, v, p.B)
  if (opts.showArms) {
    leverArm(ctx, v, p.S, p.B.x, COLORS.red)
    leverArm(ctx, v, p.E, p.B.x, COLORS.blue)
  }
  joint(ctx, v, p.S, COLORS.red)
  joint(ctx, v, p.E, COLORS.blue)

  drawBenchFront(ctx, res, f)
}

// Вид с головы: ширина хвата, локти, вертикальность предплечий
function drawBenchFront(ctx, res, f) {
  const p = f.pose
  const box = { w: 210, h: 150, x: 16, y: 14 }
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 1
  ctx.fillRect(box.x, box.y, box.w, box.h)
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h)
  label(ctx, 'Вид с головы', box.x + 8, box.y + 12, COLORS.muted)

  const yTop = res.frames.at(-1).bar.y + 6
  const y0 = BENCH_TOP - 14
  const k = Math.min((box.w - 20) / 120, (box.h - 34) / (yTop - y0))
  const X = (z) => box.x + box.w / 2 + z * k
  const Y = (y) => box.y + box.h - 8 - (y - y0) * k

  ctx.fillStyle = COLORS.line
  ctx.fillRect(X(-16), Y(BENCH_TOP), 32 * k, 5 * k)

  const E = p.E3
  for (const s of [-1, 1]) {
    ctx.strokeStyle = COLORS.flesh
    ctx.lineCap = 'round'
    ctx.lineWidth = 8 * k
    ctx.beginPath()
    ctx.moveTo(X(s * p.s), Y(p.S.y))
    ctx.lineTo(X(s * E[2]), Y(E[1]))
    ctx.lineTo(X(s * p.g), Y(p.B.y))
    ctx.stroke()
    ctx.strokeStyle = COLORS.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(X(s * p.s), Y(p.S.y))
    ctx.lineTo(X(s * E[2]), Y(E[1]))
    ctx.lineTo(X(s * p.g), Y(p.B.y))
    ctx.stroke()
    // вертикаль от кисти: насколько предплечье отклонено
    ctx.strokeStyle = 'rgba(27, 36, 48, 0.3)'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(s * p.g), Y(p.B.y))
    ctx.lineTo(X(s * p.g), Y(E[1] - 4))
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(X(-p.g - 14), Y(p.B.y))
  ctx.lineTo(X(p.g + 14), Y(p.B.y))
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(X(-p.s), Y(p.S.y))
  ctx.lineTo(X(p.s), Y(p.S.y))
  ctx.stroke()
  for (const s of [-1, 1]) {
    ctx.fillStyle = COLORS.red
    ctx.beginPath()
    ctx.arc(X(s * p.s), Y(p.S.y), 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLORS.blue
    ctx.beginPath()
    ctx.arc(X(s * E[2]), Y(E[1]), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawScene(canvas, body, res, index, opts) {
  const { ctx, width, height } = setupCanvas(canvas)
  const f = res.frames[index]
  if (!f) return
  let b
  if (res.lift === 'bench') {
    const top = res.frames.at(-1).bar.y
    b = { x0: -body.L.torso - body.L.thigh - 10, x1: 45, y0: -4, y1: top + 26 }
  } else {
    b = { x0: -78, x1: 70, y0: -6, y1: body.height * 1.04 }
  }
  const v = makeView(width, height, b)
  floor(ctx, v, b.x0 - 200, b.x1 + 200)
  if (res.lift === 'bench') drawBench(ctx, v, body, res, f, opts)
  else drawStanding(ctx, v, body, res, f, opts)
}
