import { GROUPS, groupLoad } from './anatomy.js'
import { buildBody, DEFAULT_PROFILE, estimateSegment } from './anthropometry.js'
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
  // по умолчанию — кости и мышцы; манекен — по кнопке или #look=mannequin
  look: params.get('look') === 'mannequin' ? 'mannequin' : 'anatomy',
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
  bench: [
    [
      'path',
      [
        ['optimal', 'Оптимально'],
        ['vertical', 'Вертикально'],
      ],
    ],
  ],
}

// Рычаги: какие длины влияют на движение. Ползунок — ±20 % от оценки
// по росту; пустое значение в профиле означает «по пропорциям роста».
const LEVERS = {
  squat: ['thigh', 'shin', 'torso'],
  deadlift: ['thigh', 'shin', 'torso', 'upperArm', 'forearm'],
  bench: ['upperArm', 'forearm', 'torso'],
}
const LEVER_NAMES = {
  thigh: 'Бедро',
  shin: 'Голень',
  torso: 'Торс',
  upperArm: 'Плечо',
  forearm: 'Предплечье',
}

// Постановка: [ключ, подпись, мин, макс, шаг, единица, когда показывать]
const SETUP = {
  squat: [
    ['stance', 'Разворот стоп и колен', 0, 60, 1, '°'],
    ['depth', 'Глубина ниже параллели', 0, 25, 1, '°'],
  ],
  bench: [
    ['grip', 'Хват по указательным', 40, 81, 1, 'см'],
    ['arch', 'Прогиб', 0, 20, 0.5, 'см'],
    ['flare', 'Разведение локтей', 15, 85, 1, '°'],
  ],
  deadlift: [
    [
      'sumoStance',
      'Разворот в сумо',
      20,
      70,
      1,
      '°',
      (o) => o.style === 'sumo',
    ],
  ],
}

const fmt1 = (v) => (Math.round(v * 2) / 2).toLocaleString('ru-RU')

function slider(name, label, min, max, step, value, unit, note = '') {
  return `<label class="slider3d">
      <span>${label}${note}</span>
      <output data-for="${name}">${fmt1(value)}<small>${unit}</small></output>
      <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" />
    </label>`
}

function leverRange(key) {
  const est = estimateSegment(state.profile.height, key)
  return [Math.round(est * 0.8), Math.round(est * 1.2), est]
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

  const own = state.profile.segments
  const levers = LEVERS[state.lift]
    .map((key) => {
      const [min, max, est] = leverRange(key)
      const v = own[key] ?? est
      const note = own[key] ? '' : ' <small>по росту</small>'
      return slider(
        `seg.${key}`,
        LEVER_NAMES[key],
        min,
        max,
        0.5,
        v,
        'см',
        note,
      )
    })
    .join('')

  const setup = SETUP[state.lift]
    .filter(([, , , , , , when]) => !when || when(opts))
    .map(([key, label, min, max, step, unit]) => {
      if (key === 'grip') {
        const auto = opts.grip == null
        const v = opts.grip ?? state.res?.summary.grip ?? 70
        return `${slider('opt.grip', label, min, max, step, Math.round(v), unit)}
          <label class="toggle"><input type="checkbox" name="gripAuto" ${
            auto ? 'checked' : ''
          } /> Подбирать хват автоматически</label>`
      }
      return slider(`opt.${key}`, label, min, max, step, opts[key], unit)
    })
    .join('')

  box.innerHTML = `${groups}
    <label class="field"><span>Вес штанги</span>
      <input type="number" name="load" min="20" max="500" step="2.5" value="${opts.load}" /><em>кг</em></label>
    <h3 class="sub3d">Рычаги</h3>
    ${levers}
    <button type="button" class="link3d" id="resetLevers">Вернуть пропорции по росту</button>
    ${setup ? `<h3 class="sub3d">Постановка</h3>${setup}` : ''}`
}

function schedule() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile))
  clearTimeout(recompute.t)
  recompute.t = setTimeout(recompute, 120)
}

const optionsBox = document.getElementById('options3d')
optionsBox.addEventListener('input', (e) => {
  const el = e.target
  const opts = state.profile[state.lift]
  if (el.type === 'range') {
    const v = Number(el.value)
    const out = optionsBox.querySelector(`output[data-for="${el.name}"]`)
    if (out) out.firstChild.textContent = fmt1(v)
    const [kind, key] = el.name.split('.')
    if (kind === 'seg') {
      state.profile.segments[key] = v
      const note = el.closest('label').querySelector('span small')
      if (note) note.remove()
    } else {
      opts[key] = v
      if (key === 'grip')
        optionsBox.querySelector('[name=gripAuto]').checked = false
    }
  } else if (el.name === 'gripAuto') {
    opts.grip = el.checked
      ? null
      : Number(optionsBox.querySelector('[name="opt.grip"]').value)
  } else if (el.name === 'load') {
    const v = Number(el.value)
    if (!(v >= 20 && v <= 500)) return
    opts.load = v
  } else {
    opts[el.name] = el.value
    // смена стиля тяги меняет набор ползунков
    if (el.name === 'style') renderOptions()
  }
  schedule()
})
optionsBox.addEventListener('click', (e) => {
  if (e.target.id !== 'resetLevers') return
  for (const key of Object.keys(LEVER_NAMES)) state.profile.segments[key] = null
  renderOptions()
  schedule()
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
  lastIdx = -1 // кадр тот же, но цифры новые
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
  // автоподбор хвата: ползунок показывает выбранный моделью хват
  if (state.lift === 'bench' && state.profile.bench.grip == null) {
    const g = optionsBox.querySelector('[name="opt.grip"]')
    if (g) {
      g.value = String(Math.round(s.grip))
      optionsBox.querySelector(
        'output[data-for="opt.grip"]',
      ).firstChild.textContent = fmt1(Math.round(s.grip))
    }
  }
  document.getElementById('warn3d').innerHTML = state.res.warnings
    .map((w) => `<p class="warn">${w}</p>`)
    .join('')
}

function setLook(look) {
  state.look = look === 'mannequin' ? 'mannequin' : 'anatomy'
  for (const r of document.querySelectorAll('#look3d input'))
    r.checked = r.value === state.look
  document.getElementById('anatomy3d').hidden = state.look !== 'anatomy'
  scene?.setLook(state.look)
  lastIdx = -1
}
document.getElementById('look3d').addEventListener('change', (e) => {
  setLook(e.target.value)
})

// Нагрузка мышечных групп в кадре, по убыванию
function renderMuscles(frame) {
  const rows = Object.keys(GROUPS)
    .map((g) => [GROUPS[g].name, groupLoad(g, frame.util)])
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1])
  document.getElementById('muscles3d').innerHTML = rows
    .map(([name, v]) => stat(name, n0(v * 100), '%'))
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
  if (state.look === 'anatomy') renderMuscles(f)
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
  history.replaceState(
    null,
    '',
    `#lift=${lift}${state.look === 'mannequin' ? '&look=mannequin' : ''}`,
  )
  renderOptions()
  recompute()
}
for (const t of tabs)
  t.addEventListener('click', () => selectLift(t.dataset.lift))

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  setPlaying(false)

setLook(state.look)
selectLift(state.lift)

// #t=0.5&view=side — открыть на паузе в фазе и ракурсе (для ссылок и скриншотов)
const t0 = Number(params.get('t'))
if (Number.isFinite(t0) && t0 > 0) {
  setPlaying(false)
  scene?.scrub(t0)
}
// #close=2 — крупный план, #aim=0.3 — сдвинуть цель по высоте, м
if (params.get('view')) {
  scene?.setView(params.get('view'), Number(params.get('close')) || 1)
  const aim = Number(params.get('aim'))
  if (scene && aim) {
    scene.controls.target.y += aim
    scene.camera.position.y += aim
  }
}
