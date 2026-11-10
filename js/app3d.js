import { buildBody, DEFAULT_PROFILE } from './anthropometry.js'
import { LiftScene } from './scene3d.js'
import { solveBench, solveDeadlift, solveSquat } from './solver.js'

// Профиль общий с 2D-страницей
const STORAGE_KEY = 'lift-sim:profile'

function loadProfile() {
  const base = JSON.parse(JSON.stringify(DEFAULT_PROFILE))
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    for (const [k, v] of Object.entries(saved ?? {})) {
      if (!(k in base)) continue
      base[k] = v && typeof v === 'object' ? { ...base[k], ...v } : v
    }
  } catch {}
  return base
}

const params = new URLSearchParams(location.hash.slice(1))
const state = {
  profile: loadProfile(),
  lift: ['squat', 'bench', 'deadlift'].includes(params.get('lift'))
    ? params.get('lift')
    : 'squat',
  res: null,
}

const canvas = document.getElementById('view3d')
let scene
try {
  scene = new LiftScene(canvas)
} catch (e) {
  console.error(e)
  document.getElementById('noWebgl').hidden = false
}

// ---------------------------------------------------------------------------

const OPTIONS = {
  squat: [
    [
      'barPosition',
      [
        ['high', 'Высокий гриф'],
        ['low', 'Низкий гриф'],
      ],
    ],
  ],
  deadlift: [
    [
      'style',
      [
        ['conventional', 'Классика'],
        ['sumo', 'Сумо'],
      ],
    ],
  ],
  bench: [],
}

function renderOptions() {
  const box = document.getElementById('options3d')
  const opts = state.profile[state.lift]
  const groups = OPTIONS[state.lift]
    .map(
      ([key, choices]) =>
        `<div class="seg" role="radiogroup">${choices
          .map(
            ([value, label]) =>
              `<label><input type="radio" name="${key}" value="${value}" ${
                opts[key] === value ? 'checked' : ''
              } /> ${label}</label>`,
          )
          .join('')}</div>`,
    )
    .join('')
  box.innerHTML = `${groups}
    <label class="field"><span>Вес штанги</span>
      <input type="number" name="load" min="20" max="500" step="2.5" value="${opts.load}" /><em>кг</em></label>`
}

document.getElementById('options3d').addEventListener('input', (e) => {
  const el = e.target
  const opts = state.profile[state.lift]
  if (el.name === 'load') {
    const v = Number(el.value)
    if (!(v >= 20 && v <= 500)) return
    opts.load = v
  } else {
    opts[el.name] = el.value
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile))
  clearTimeout(recompute.t)
  recompute.t = setTimeout(recompute, 150)
})

// ---------------------------------------------------------------------------

const n0 = (v) => Math.round(v).toLocaleString('ru-RU')
const stat = (name, value, unit) =>
  `<dt>${name}</dt><dd>${value}<small>${unit}</small></dd>`

function recompute() {
  const body = buildBody(state.profile)
  const opts = state.profile[state.lift]
  const solve = {
    squat: solveSquat,
    bench: solveBench,
    deadlift: solveDeadlift,
  }
  state.body = body
  state.res = solve[state.lift](body, opts)
  scene?.setResult(body, state.res, opts)
  renderSummary()
}

function renderSummary() {
  const s = state.res.summary
  let html
  if (state.lift === 'squat') {
    html =
      stat('Наклон торса внизу', n0(s.bottom.trunk), '°') +
      stat('Пик момента в тазу', n0(s.peakMoments.hip), 'Н·м') +
      stat('Пик момента в колене', n0(s.peakMoments.knee), 'Н·м') +
      stat('Путь грифа', n0(s.rom), 'см')
  } else if (state.lift === 'deadlift') {
    html =
      stat('Спина к полу на старте', n0(90 - s.start.trunk), '°') +
      stat('Высота таза на старте', n0(s.hipHeight), 'см') +
      stat('Пик момента в тазу', n0(s.peakMoments.hip), 'Н·м') +
      stat('Путь грифа', n0(s.rom), 'см')
  } else {
    html =
      stat('Хват по указательным', n0(s.grip), 'см') +
      stat('Путь грифа', n0(s.rom), 'см') +
      stat('Пик момента в плече', n0(s.peakMoments.shoulder), 'Н·м') +
      stat('Пик момента в локте', n0(s.peakMoments.elbow), 'Н·м')
  }
  document.getElementById('summary3d').innerHTML = html
  document.getElementById('warn3d').innerHTML = state.res.warnings
    .map((w) => `<p class="warn">${w}</p>`)
    .join('')
}

const live = document.getElementById('live3d')
const scrub = document.getElementById('scrub3d')
let lastIdx = -1
function onFrame(phase) {
  if (!state.res) return
  const N = state.res.frames.length
  const t = state.lift === 'bench' ? 1 - phase : phase
  const idx = Math.round(t * (N - 1))
  if (!scrubbing) scrub.value = String(Math.round(phase * 1000))
  if (idx === lastIdx) return
  lastIdx = idx
  const f = state.res.frames[idx]
  if (state.lift === 'bench') {
    live.innerHTML =
      stat('Высота грифа', n0(f.bar.y), 'см') +
      stat('Угол в локте', n0(f.angles.elbow), '°') +
      stat('Момент в плече', n0(f.moments.shoulder), 'Н·м') +
      stat('Момент в локте', n0(f.moments.elbow), 'Н·м')
  } else {
    live.innerHTML =
      stat('Высота грифа', n0(f.bar.y), 'см') +
      stat('Наклон торса', n0(f.angles.trunk), '°') +
      stat('Сгибание колена', n0(f.angles.knee), '°') +
      stat('Момент в тазу', n0(f.moments.hip), 'Н·м') +
      stat('Момент в колене', n0(f.moments.knee), 'Н·м')
  }
}
if (scene) scene.onFrame = onFrame

// ---------------------------------------------------------------------------

const playBtn = document.getElementById('play3d')
let scrubbing = false
function setPlaying(on) {
  scene?.setPlaying(on)
  playBtn.textContent = on ? 'Пауза' : 'Играть'
}
playBtn.addEventListener('click', () => setPlaying(!scene?.playing))
scrub.addEventListener('input', () => {
  scrubbing = true
  setPlaying(false)
  scene?.scrub(Number(scrub.value) / 1000)
})
scrub.addEventListener('change', () => {
  scrubbing = false
})
document.getElementById('path3d').addEventListener('change', (e) => {
  scene?.setBarPath(e.target.checked)
})
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => scene?.setView(b.dataset.view))
}

const tabs = document.querySelectorAll('.lifts button')
function selectLift(lift) {
  state.lift = lift
  lastIdx = -1
  for (const t of tabs)
    t.setAttribute('aria-selected', String(t.dataset.lift === lift))
  document.getElementById('to2d').href = `index.html#lift=${lift}`
  history.replaceState(null, '', `#lift=${lift}`)
  renderOptions()
  recompute()
}
for (const t of tabs)
  t.addEventListener('click', () => selectLift(t.dataset.lift))

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  setPlaying(false)

selectLift(state.lift)

// #t=0.5&view=side — открыть на паузе в фазе и ракурсе (для ссылок и скриншотов)
const t0 = Number(params.get('t'))
if (Number.isFinite(t0) && t0 > 0) {
  setPlaying(false)
  scene?.scrub(t0)
}
if (params.get('view')) scene?.setView(params.get('view'))
