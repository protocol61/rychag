// Простой линейный график: ось x — высота грифа, маркер текущего кадра.
import { COLORS, setupCanvas } from './render.js'

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(+v.toFixed(6))
  }
  return out
}

export function drawChart(canvas, { x, series, marker }) {
  const { ctx, width, height } = setupCanvas(canvas)
  const pad = { l: 40, r: 10, t: 8, b: 26 }
  const xs = [Math.min(...x), Math.max(...x)]
  const all = series.flatMap((s) => s.values)
  let y0 = Math.min(0, ...all)
  let y1 = Math.max(...all)
  if (y1 - y0 < 1) y1 = y0 + 1
  y1 += (y1 - y0) * 0.05
  const X = (v) =>
    pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (width - pad.l - pad.r)
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b)

  ctx.font = '11px "Golos Text", system-ui, sans-serif'
  ctx.fillStyle = COLORS.muted
  ctx.strokeStyle = '#e6e9ec'
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const t of niceTicks(y0, y1)) {
    ctx.beginPath()
    ctx.moveTo(pad.l, Y(t))
    ctx.lineTo(width - pad.r, Y(t))
    ctx.stroke()
    ctx.fillText(String(t), pad.l - 6, Y(t))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const t of niceTicks(xs[0], xs[1], 5)) {
    ctx.fillText(String(t), X(t), height - pad.b + 6)
  }

  if (y0 < 0) {
    ctx.strokeStyle = COLORS.line
    ctx.beginPath()
    ctx.moveTo(pad.l, Y(0))
    ctx.lineTo(width - pad.r, Y(0))
    ctx.stroke()
  }

  for (const s of series) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 2
    ctx.setLineDash(s.dash ?? [])
    ctx.beginPath()
    s.values.forEach((v, i) =>
      i ? ctx.lineTo(X(x[i]), Y(v)) : ctx.moveTo(X(x[i]), Y(v)),
    )
    ctx.stroke()
  }
  ctx.setLineDash([])

  if (marker != null) {
    const mx = X(x[marker])
    ctx.strokeStyle = COLORS.ink
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mx, pad.t)
    ctx.lineTo(mx, height - pad.b)
    ctx.stroke()
    for (const s of series) {
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(mx, Y(s.values[marker]), 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
