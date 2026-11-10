import {
  buildBody,
  DEFAULT_PROFILE,
  estimateSegment,
  MEASURABLE,
} from './anthropometry.js'
import { drawChart } from './chart.js'
import { initMeasureGuide } from './measure.js'
import { COLORS, drawScene } from './render.js'
import { CAPACITY, solveBench, solveDeadlift, solveSquat } from './solver.js'

const STORAGE_KEY = 'lift-sim:profile'

const SEGMENT_LABELS = {
  thigh: ['Бедро', 'большой вертел — щель колена'],
  shin: ['Голень', 'щель колена — лодыжка'],
  torso: ['Торс', 'большой вертел — акромион'],
  upperArm: ['Плечо', 'акромион — локоть'],
  forearm: ['Предплечье', 'локоть — запястье'],
  foot: ['Стопа', 'пятка — носок'],
}

const LIFT_NAMES = {
  squat: 'Присед',
  bench: 'Жим лёжа',
  deadlift: 'Становая тяга',
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o))

function merge(base, extra) {
  const out = clone(base)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k]) {
      out[k] = { ...out[k], ...v }
    } else if (k in out) {
      out[k] = v
    }
  }
  return out
}

function loadProfile() {
  const hash = new URLSearchParams(location.hash.slice(1)).get('p')
  if (hash) {
    try {
      const json = decodeURIComponent(escape(atob(hash)))
      return merge(DEFAULT_PROFILE, JSON.parse(json))
    } catch {
      // битая ссылка — берём сохранённое
    }
  }
  try {
    return merge(DEFAULT_PROFILE, JSON.parse(localStorage.getItem(STORAGE_KEY)))
  } catch {
    return clone(DEFAULT_PROFILE)
  }
}

const state = {
  profile: loadProfile(),
  lift: new URLSearchParams(location.hash.slice(1)).get('lift') ?? 'squat',
  result: null,
  compare: null,
  body: null,
  playing: true,
  phase: 0, // 0 — стартовая позиция, 1 — точка разворота
  clock: 0,
}

if (!LIFT_NAMES[state.lift]) state.lift = 'squat'

// #t=0.7 — открыть на паузе в заданной фазе повтора (для ссылок и скриншотов)
const fixedPhase = Number(new URLSearchParams(location.hash.slice(1)).get('t'))

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)
function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => o[k], obj)
  target[last] = value
}

// ---------------------------------------------------------------------------
// Форма
// ---------------------------------------------------------------------------

const form = document.getElementById('form')

function buildSegmentFields() {
  const box = document.getElementById('segments')
  box.innerHTML = MEASURABLE.map((key) => {
    const [name, hint] = SEGMENT_LABELS[key]
    return `<label class="field">
      <span>${name}<small>${hint}</small></span>
      <input type="number" name="segments.${key}" min="5" max="120" step="0.5" />
      <em>см</em>
    </label>`
  }).join('')
}

const NULLABLE = (name) => name.startsWith('segments.') || name === 'bench.grip'

function fillForm() {
  for (const el of form.elements) {
    if (!el.name) continue
    const value = getPath(state.profile, el.name)
    if (el.type === 'radio') el.checked = el.value === value
    else el.value = value ?? ''
  }
  updatePlaceholders()
}

function updatePlaceholders() {
  for (const key of MEASURABLE) {
    const el = form.elements[`segments.${key}`]
    el.placeholder = `≈${estimateSegment(state.profile.height, key)}`
  }
}

form.addEventListener('input', (e) => {
  const el = e.target
  if (!el.name) return
  let value
  if (el.type === 'radio') value = el.value
  else if (el.value === '') {
    if (!NULLABLE(el.name)) return
    value = null
  } else {
    value = Number(el.value)
    if (!Number.isFinite(value)) return
    if (el.min !== '' && value < Number(el.min)) return
    if (el.max !== '' && value > Number(el.max)) return
  }
  setPath(state.profile, el.name, value)
  if (el.name === 'height') updatePlaceholders()
  scheduleCompute()
})

document.getElementById('reset').addEventListener('click', () => {
  state.profile = clone(DEFAULT_PROFILE)
  fillForm()
  scheduleCompute()
})

// ---------------------------------------------------------------------------
// Вкладки и ссылка
// ---------------------------------------------------------------------------

const tabs = document.querySelectorAll('.lifts button')

function selectLift(lift) {
  state.lift = lift
  for (const t of tabs)
    t.setAttribute('aria-selected', String(t.dataset.lift === lift))
  document.getElementById('to3d').href = `3d.html#lift=${lift}`
  for (const fs of form.querySelectorAll('fieldset[data-for]')) {
    fs.classList.toggle('active', fs.dataset.for === lift)
  }
  state.phase = 0
  state.clock = 0
  scheduleCompute(0)
}

for (const t of tabs)
  t.addEventListener('click', () => selectLift(t.dataset.lift))

document.getElementById('share').addEventListener('click', async () => {
  const json = JSON.stringify(state.profile)
  const p = btoa(unescape(encodeURIComponent(json)))
  const url = `${location.origin}${location.pathname}#lift=${state.lift}&p=${p}`
  history.replaceState(null, '', url)
  try {
    await navigator.clipboard.writeText(url)
    toast('Ссылка скопирована')
  } catch {
    toast('Ссылка в адресной строке — скопируйте её оттуда')
  }
})

function toast(text) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.append(el)
  setTimeout(() => el.remove(), 2200)
}

// ---------------------------------------------------------------------------
// Расчёт
// ---------------------------------------------------------------------------

let timer = null
function scheduleCompute(delay = 140) {
  clearTimeout(timer)
  timer = setTimeout(compute, delay)
}

function compute() {
  const p = state.profile
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  const body = buildBody(p)
  state.body = body
  if (state.lift === 'squat') {
    const other = p.squat.barPosition === 'high' ? 'low' : 'high'
    state.result = solveSquat(body, p.squat)
    state.compare = solveSquat(body, { ...p.squat, barPosition: other })
  } else if (state.lift === 'deadlift') {
    const other = p.deadlift.style === 'sumo' ? 'conventional' : 'sumo'
    state.result = solveDeadlift(body, p.deadlift)
    state.compare = solveDeadlift(body, { ...p.deadlift, style: other })
  } else {
    state.result = solveBench(body, p.bench)
    state.compare = null
  }
  renderResults()
  renderCharts()
  renderScene()
}

// ---------------------------------------------------------------------------
// Результаты
// ---------------------------------------------------------------------------

const n0 = (v) => Math.round(v).toLocaleString('ru-RU')
const n1 = (v) =>
  v.toLocaleString('ru-RU', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })
const pct = (a, b) => Math.round((1 - a / b) * 100)

function stat(name, value, unit) {
  return `<dt>${name}</dt><dd>${value}<small>${unit}</small></dd>`
}

// Индекс нагрузки: сумма пиковых моментов, отнесённых к силе суставов.
// Линейный, чтобы проценты в выводах читались как «на сколько легче».
function peakCost(res) {
  const m = res.summary.peakMoments
  const W = state.body.weight
  if (res.lift === 'bench') {
    return m.shoulder / (CAPACITY.shoulder * W) + m.elbow / (CAPACITY.elbow * W)
  }
  return m.hip / (CAPACITY.hip * W) + m.knee / (CAPACITY.knee * W)
}

function compareTable(headA, headB, rows) {
  const body = rows
    .map(([name, a, b, fmt, lowerWins]) => {
      let ca = ''
      let cb = ''
      if (lowerWins !== undefined && Math.abs(a - b) > 1e-6) {
        const aBetter = lowerWins ? a < b : a > b
        if (aBetter) ca = 'win'
        else cb = 'win'
      }
      return `<tr><td>${name}</td><td class="${ca}">${fmt(a)}</td><td class="${cb}">${fmt(b)}</td></tr>`
    })
    .join('')
  return `<table class="compare">
    <thead><tr><th></th><th>${headA}</th><th>${headB}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function warningsHtml(res) {
  return res.warnings.map((w) => `<p class="warn">${w}</p>`).join('')
}

function renderSquat(res, cmp) {
  const s = res.summary
  const b = state.body
  const ratio = b.L.thigh / b.L.torso
  const cur = state.profile.squat.barPosition
  const names = { high: 'Высокий гриф', low: 'Низкий гриф' }
  const better = peakCost(res) <= peakCost(cmp) ? res : cmp
  const betterPos = better === res ? cur : cur === 'high' ? 'low' : 'high'
  const gain = pct(
    Math.min(peakCost(res), peakCost(cmp)),
    Math.max(peakCost(res), peakCost(cmp)),
  )
  const hipShare = Math.round(
    (100 * s.peakMoments.hip) / (s.peakMoments.hip + s.peakMoments.knee),
  )
  const lean = s.bottom.trunk
  const leanText =
    lean > 45
      ? 'сильный наклон вперёд: длинное бедро относительно торса'
      : lean > 35
        ? 'заметный наклон вперёд'
        : 'корпус почти вертикален'

  const leanDiff = Math.abs(res.summary.bottom.trunk - cmp.summary.bottom.trunk)
  const verdict =
    gain < 3
      ? `При одном и том же положении ног моменты в тазу и колене не зависят от того, где лежит гриф: баланс над серединой стопы диктует их однозначно. Меняется наклон торса — на ${n0(leanDiff)}°, и низкому грифу нужно больше складываться в тазу. Выбирайте по удобству плеч и подвижности.`
      : `Модели выгоднее <b>${names[betterPos].toLowerCase()}</b>: пиковая нагрузка на суставы ниже на ${gain}%. Разница появляется из-за ограничений подвижности.`

  return `
    <h2>Нижняя точка</h2>
    <p class="verdict">Наклон торса ${n0(lean)}° — ${leanText}. Таз берёт ${hipShare}% работы, колени ${100 - hipShare}%.</p>
    <dl class="stats">
      ${stat('Отношение бедро / торс', n1(ratio), '')}
      ${stat('Наклон торса', n0(lean), '°')}
      ${stat('Сгибание колена', n0(s.bottom.knee), '°')}
      ${stat('Голень вперёд', n0(s.bottom.ankle), '°')}
      ${stat('Колено за носком', s.kneeOverToe > 0 ? n0(s.kneeOverToe) : 0, 'см')}
      ${stat('Пик момента в тазу', n0(s.peakMoments.hip), 'Н·м')}
      ${stat('Пик момента в колене', n0(s.peakMoments.knee), 'Н·м')}
      ${stat('Самое тяжёлое место', n0(s.peakBarY), 'см от пола')}
      ${stat('Путь грифа', n0(s.rom), 'см')}
      ${stat('Работа за подъём', n0(s.work), 'Дж')}
    </dl>
    ${warningsHtml(res)}
    <h2>Высокий или низкий гриф</h2>
    <p class="verdict">${verdict}</p>
    ${compareTable(names[cur], names[cur === 'high' ? 'low' : 'high'], [
      [
        'Наклон торса',
        res.summary.bottom.trunk,
        cmp.summary.bottom.trunk,
        (v) => `${n0(v)}°`,
      ],
      [
        'Момент в тазу',
        res.summary.peakMoments.hip,
        cmp.summary.peakMoments.hip,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Момент в колене',
        res.summary.peakMoments.knee,
        cmp.summary.peakMoments.knee,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Путь грифа',
        res.summary.rom,
        cmp.summary.rom,
        (v) => `${n0(v)} см`,
        true,
      ],
      ['Индекс нагрузки', peakCost(res), peakCost(cmp), (v) => n1(v), true],
    ])}`
}

function momentDelta(res, cmp, nameA, nameB) {
  const parts = []
  for (const [key, joint] of [
    ['hip', 'тазу'],
    ['knee', 'колене'],
  ]) {
    const a = res.summary.peakMoments[key]
    const b = cmp.summary.peakMoments[key]
    const d = Math.round(Math.abs(1 - b / a) * 100)
    if (d < 3) continue
    parts.push(`в ${joint} ${b < a ? 'ниже' : 'выше'} на ${d}%`)
  }
  return parts.length
    ? `Пиковый момент у варианта «${nameB}» ${parts.join(', ')}, чем у «${nameA}».`
    : ''
}

function renderDeadlift(res, cmp) {
  const s = res.summary
  const cur = state.profile.deadlift.style
  const names = { conventional: 'Классика', sumo: 'Сумо' }
  const other = cur === 'sumo' ? 'conventional' : 'sumo'
  const a = peakCost(res)
  const b = peakCost(cmp)
  const gain = pct(Math.min(a, b), Math.max(a, b))
  const betterName = a <= b ? names[cur] : names[other]
  const verdict =
    gain < 3
      ? 'Классика и сумо для вас почти равноценны по нагрузке.'
      : `Модели выгоднее <b>${betterName.toLowerCase()}</b>: суммарная нагрузка на таз и колени ниже на ${gain}%. ${momentDelta(res, cmp, names[cur], names[other])}`
  const backAngle = 90 - s.start.trunk
  return `
    <h2>Стартовая позиция</h2>
    <p class="verdict">Спина под ${n0(backAngle)}° к полу, таз на высоте ${n0(s.hipHeight)} см. Плечи над грифом, голени касаются грифа.</p>
    <dl class="stats">
      ${stat('Угол спины к полу', n0(backAngle), '°')}
      ${stat('Высота таза', n0(s.hipHeight), 'см')}
      ${stat('Сгибание колена', n0(s.start.knee), '°')}
      ${stat('Угол бедро — торс', n0(s.start.hip), '°')}
      ${stat('Пик момента в тазу', n0(s.peakMoments.hip), 'Н·м')}
      ${stat('Пик момента в колене', n0(s.peakMoments.knee), 'Н·м')}
      ${stat('Самое тяжёлое место', n0(s.peakBarY), 'см от пола')}
      ${stat('Путь грифа', n0(s.rom), 'см')}
      ${stat('Работа за подъём', n0(s.work), 'Дж')}
    </dl>
    ${warningsHtml(res)}
    <h2>Классика или сумо</h2>
    <p class="verdict">${verdict}</p>
    ${compareTable(names[cur], names[other], [
      [
        'Угол спины к полу',
        90 - res.summary.start.trunk,
        90 - cmp.summary.start.trunk,
        (v) => `${n0(v)}°`,
      ],
      [
        'Высота таза',
        res.summary.hipHeight,
        cmp.summary.hipHeight,
        (v) => `${n0(v)} см`,
      ],
      [
        'Момент в тазу',
        res.summary.peakMoments.hip,
        cmp.summary.peakMoments.hip,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Момент в колене',
        res.summary.peakMoments.knee,
        cmp.summary.peakMoments.knee,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Путь грифа',
        res.summary.rom,
        cmp.summary.rom,
        (v) => `${n0(v)} см`,
        true,
      ],
      ['Индекс нагрузки', a, b, (v) => n1(v), true],
    ])}`
}

const PATH_NAMES = { optimal: 'Оптимально', vertical: 'Вертикально' }

function benchPathSection(s) {
  const cur = s.path
  const o = s.otherPath
  const opt = cur === 'optimal' ? s.pathMoments : o
  const vert = cur === 'optimal' ? o : s.pathMoments
  const gain = pct(opt.mean.shoulder, vert.mean.shoulder)
  const flares = state.result.frames.map((f) => f.pose.flare)
  const flareText =
    cur === 'optimal'
      ? ` Локти по ходу раскрываются с ${n0(flares[0])}° до ${n0(Math.max(...flares))}°.`
      : ''
  const verdict =
    gain > 2
      ? `По оптимальной траектории гриф уходит к голове на ${n0(opt.drift)} см и встаёт над плечом — средний момент в плече на ${gain}% ниже, чем при вертикальном жиме.${flareText}`
      : 'Для вашей постановки вертикальный и оптимальный путь почти равноценны по нагрузке на плечо.'
  const [a, b] = cur === 'optimal' ? [opt, vert] : [vert, opt]
  const romCur = s.rom
  const romOther = o.rom
  return `
    <h2>Траектория грифа</h2>
    <p class="verdict">${verdict}</p>
    ${compareTable(PATH_NAMES[cur], PATH_NAMES[o.path], [
      ['Сдвиг к голове', a.drift, b.drift, (v) => `${n0(v)} см`],
      [
        'Плечо, в среднем',
        a.mean.shoulder,
        b.mean.shoulder,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Плечо, пик',
        a.peak.shoulder,
        b.peak.shoulder,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      [
        'Локоть, в среднем',
        a.mean.elbow,
        b.mean.elbow,
        (v) => `${n0(v)} Н·м`,
        true,
      ],
      ['Путь грифа', romCur, romOther, (v) => `${n0(v)} см`, true],
    ])}`
}

function renderBench(res) {
  const s = res.summary
  const arch = state.profile.bench.arch
  const saved = s.romFlat - s.rom
  const gripRatio = (s.grip + 8) / s.shoulderW
  const side = Math.abs(s.bottom.forearmSide)
  const front = Math.abs(s.bottom.forearmFront)
  const gripText = s.gripAuto
    ? `Модель подобрала хват <b>${n0(s.grip)} см</b> между указательными пальцами`
    : `Хват ${n0(s.grip)} см между указательными пальцами`
  return `
    <h2>Нижняя точка</h2>
    <p class="verdict">${gripText} — это ${n1(gripRatio)} ширины плеч. Касание на ${n0(Math.abs(s.touchX))} см ниже плечевого сустава.</p>
    <dl class="stats">
      ${stat('Хват по указательным', n0(s.grip), 'см')}
      ${stat('Угол в локте', n0(s.bottom.elbow), '°')}
      ${stat('Предплечье от вертикали сбоку', n0(side), '°')}
      ${stat('Предплечье от вертикали с головы', n0(front), '°')}
      ${stat('Пик момента в плече', n0(s.peakMoments.shoulder), 'Н·м')}
      ${stat('Пик момента в локте', n0(s.peakMoments.elbow), 'Н·м')}
      ${stat('Самое тяжёлое место', n0(s.peakBarY), 'см от пола')}
      ${stat('Путь грифа', n0(s.rom), 'см')}
      ${stat('Работа за подъём', n0(s.work), 'Дж')}
    </dl>
    ${warningsHtml(res)}
    ${benchPathSection(s)}
    <h2>Что даёт прогиб</h2>
    <p class="verdict">${
      arch > 0
        ? `Прогиб ${n1(arch)} см сокращает путь грифа на ${n1(saved)} см — это ${pct(s.rom, s.romFlat)}% работы за повтор.`
        : 'Вы жмёте без прогиба. Укажите высоту прогиба, чтобы увидеть, сколько пути он срезает.'
    }</p>
    ${compareTable('Ровно', `Прогиб ${n1(arch)} см`, [
      ['Путь грифа', s.romFlat, s.rom, (v) => `${n1(v)} см`, true],
      [
        'Работа',
        (state.profile.bench.load * 9.81 * s.romFlat) / 100,
        s.work,
        (v) => `${n0(v)} Дж`,
        true,
      ],
    ])}`
}

function renderResults() {
  const res = state.result
  const el = document.getElementById('results')
  if (res.lift === 'squat') el.innerHTML = renderSquat(res, state.compare)
  else if (res.lift === 'deadlift')
    el.innerHTML = renderDeadlift(res, state.compare)
  else el.innerHTML = renderBench(res)
}

// ---------------------------------------------------------------------------
// Графики
// ---------------------------------------------------------------------------

function seriesFor(res) {
  const F = res.frames
  if (res.lift === 'bench') {
    return {
      moments: [
        {
          name: 'Плечо',
          color: COLORS.red,
          values: F.map((f) => f.moments.shoulder),
        },
        {
          name: 'Локоть',
          color: COLORS.blue,
          values: F.map((f) => f.moments.elbow),
        },
      ],
      angles: [
        {
          name: 'Локоть',
          color: COLORS.blue,
          values: F.map((f) => f.angles.elbow),
        },
        {
          name: 'Разведение локтей',
          color: COLORS.red,
          values: F.map((f) => f.pose.flare),
        },
        {
          name: 'Предплечье с головы',
          color: COLORS.green,
          values: F.map((f) => f.angles.forearmFront),
        },
      ],
    }
  }
  return {
    moments: [
      { name: 'Таз', color: COLORS.red, values: F.map((f) => f.moments.hip) },
      {
        name: 'Колено',
        color: COLORS.blue,
        values: F.map((f) => f.moments.knee),
      },
      {
        name: 'Голеностоп',
        color: COLORS.yellow,
        values: F.map((f) => f.moments.ankle),
      },
    ],
    angles: [
      {
        name: 'Бедро — торс',
        color: COLORS.red,
        values: F.map((f) => f.angles.hip),
      },
      {
        name: 'Колено',
        color: COLORS.blue,
        values: F.map((f) => f.angles.knee),
      },
      {
        name: 'Наклон торса',
        color: COLORS.ink,
        values: F.map((f) => f.angles.trunk),
        dash: [5, 4],
      },
    ],
  }
}

function legend(el, series) {
  el.innerHTML = series
    .map((s) => `<i style="--c:${s.color}">${s.name}</i>`)
    .join('')
}

let chartSeries = null
function renderCharts() {
  chartSeries = seriesFor(state.result)
  legend(document.getElementById('legendMoments'), chartSeries.moments)
  legend(document.getElementById('legendAngles'), chartSeries.angles)
}

// ---------------------------------------------------------------------------
// Анимация
// ---------------------------------------------------------------------------

const scene = document.getElementById('scene')
const scrub = document.getElementById('scrub')
const playBtn = document.getElementById('play')
const showArms = document.getElementById('showArms')

function frameIndex() {
  const res = state.result
  const N = res.frames.length
  const p = state.phase
  // жим: кадры идут снизу вверх, а повтор начинается в локауте
  const t = res.lift === 'bench' ? 1 - p : p
  return Math.round(t * (N - 1))
}

function renderScene() {
  if (!state.result) return
  const idx = frameIndex()
  drawScene(scene, state.body, state.result, idx, {
    showArms: showArms.checked,
  })
  if (chartSeries) {
    const x = state.result.frames.map((f) => f.bar.y)
    drawChart(document.getElementById('chartMoments'), {
      x,
      series: chartSeries.moments,
      marker: idx,
    })
    drawChart(document.getElementById('chartAngles'), {
      x,
      series: chartSeries.angles,
      marker: idx,
    })
  }
  scrub.value = String(Math.round(state.phase * 1000))
}

const ease = (t) => t * t * (3 - 2 * t)
const REP = 3.2 // секунды на повтор

// Цикл: ход 45 %, пауза 5 %, обратный ход 45 %, пауза 5 %
function phaseAt(c) {
  if (c < 0.45) return ease(c / 0.45)
  if (c < 0.5) return 1
  if (c < 0.95) return 1 - ease((c - 0.5) / 0.45)
  return 0
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
if (reduceMotion.matches) setPlaying(false)

let last = performance.now()
function tick(now) {
  const dt = (now - last) / 1000
  last = now
  if (state.playing && state.result) {
    state.clock = (state.clock + dt / REP) % 1
    state.phase = phaseAt(state.clock)
    renderScene()
  }
  requestAnimationFrame(tick)
}

function setPlaying(on) {
  state.playing = on
  playBtn.textContent = on ? 'Пауза' : 'Играть'
  playBtn.setAttribute('aria-label', on ? 'Пауза' : 'Играть')
}

playBtn.addEventListener('click', () => {
  if (!state.playing) {
    // продолжить с текущего положения ползунка (на ходе вперёд)
    state.clock = 0.45 * state.phase
  }
  setPlaying(!state.playing)
})

scrub.addEventListener('input', () => {
  setPlaying(false)
  state.phase = Number(scrub.value) / 1000
  renderScene()
})

showArms.addEventListener('change', renderScene)
window.addEventListener('resize', renderScene)

// ---------------------------------------------------------------------------

initMeasureGuide({
  getHeight: () => state.profile.height,
  onApply: (values) => {
    const { ankle, hip, ...segments } = values
    Object.assign(state.profile.segments, segments)
    if (ankle != null) state.profile.mobility.ankle = ankle
    if (hip != null) state.profile.mobility.hip = hip
    fillForm()
    scheduleCompute(0)
    toast('Замеры подставлены в профиль')
  },
})

buildSegmentFields()
fillForm()
selectLift(state.lift)
// #guide=body | mobility — открыть инструкцию по замерам сразу
const guideParam = new URLSearchParams(location.hash.slice(1)).get('guide')
if (guideParam === 'body' || guideParam === 'mobility') {
  document.querySelector(`[data-open-guide="${guideParam}"]`)?.click()
}
if (Number.isFinite(fixedPhase) && fixedPhase > 0) {
  setPlaying(false)
  state.phase = Math.min(1, fixedPhase)
}
requestAnimationFrame(tick)
