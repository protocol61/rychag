// Инструкция по замерам: из высот от пола и углов с телефона получаем
// длины сегментов и подвижность в тех определениях, что использует модель.

const STORAGE_KEY = 'lift-sim:measure'

// Допустимые диапазоны итоговых значений (как в полях профиля)
const RANGES = {
  torso: [35, 75],
  thigh: [30, 60],
  shin: [30, 60],
  upperArm: [20, 50],
  forearm: [15, 40],
  foot: [18, 35],
  ankle: [10, 50],
  hip: [90, 160],
}

const NAMES = {
  torso: 'торс',
  thigh: 'бедро',
  shin: 'голень',
  upperArm: 'плечо',
  forearm: 'предплечье',
  foot: 'стопа',
  ankle: 'голеностоп',
  hip: 'угол бедро — торс',
}

const num = (v) => (v === '' || v == null ? null : Number(v))
const round1 = (v) => Math.round(v * 10) / 10

export function computeMeasurements(raw, height) {
  const r = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, k === 'ankleRef' ? v : num(v)]),
  )
  const values = {}
  const errors = []

  const diff = (key, top, bottom, topName, bottomName) => {
    if (r[top] == null || r[bottom] == null) return
    if (r[top] <= r[bottom]) {
      errors.push(`Отметка «${topName}» должна быть выше, чем «${bottomName}».`)
      return
    }
    values[key] = round1(r[top] - r[bottom])
  }
  diff('torso', 'acromion', 'trochanter', 'акромион', 'вертел')
  diff('thigh', 'trochanter', 'knee', 'вертел', 'щель колена')
  diff('shin', 'knee', 'malleolus', 'щель колена', 'лодыжка')
  for (const key of ['upperArm', 'forearm', 'foot']) {
    if (r[key] != null) values[key] = r[key]
  }
  if (r.ankleReading != null) {
    values.ankle = Math.round(
      r.ankleRef === 'horizontal' ? 90 - r.ankleReading : r.ankleReading,
    )
  }
  if (r.hipPhoto != null) values.hip = Math.round(180 - r.hipPhoto)

  for (const [key, v] of Object.entries(values)) {
    const [lo, hi] = RANGES[key]
    if (v < lo || v > hi) {
      errors.push(
        `Получилось ${NAMES[key]} ${v}, а ожидается от ${lo} до ${hi}. Проверьте замер.`,
      )
      delete values[key]
    }
  }

  // Акромион обычно на высоте ~82 % роста (±4 %)
  const notes = []
  if (height && r.acromion != null) {
    const ratio = r.acromion / height
    if (ratio < 0.77 || ratio > 0.86) {
      notes.push(
        `Акромион на ${Math.round(ratio * 100)} % роста — обычно 78–85 %. Проверьте точку и рост в профиле.`,
      )
    }
  }
  return { values, errors, notes }
}

export function initMeasureGuide({ getHeight, onApply }) {
  const dialog = document.getElementById('guide')
  const form = document.getElementById('measureForm')
  const summary = document.getElementById('measureSummary')

  const read = () => {
    const raw = {}
    for (const el of form.elements) {
      if (!el.name) continue
      if (el.type === 'radio') {
        if (el.checked) raw[el.name] = el.value
      } else raw[el.name] = el.value
    }
    return raw
  }

  const restore = () => {
    let saved = {}
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
    } catch {}
    for (const el of form.elements) {
      if (!el.name || !(el.name in saved)) continue
      if (el.type === 'radio') el.checked = el.value === saved[el.name]
      else el.value = saved[el.name]
    }
  }

  const fmt = (key, v) =>
    `${NAMES[key]} ${v.toLocaleString('ru-RU')}${key === 'ankle' || key === 'hip' ? '°' : ' см'}`

  const update = () => {
    const raw = read()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw))
    const { values, errors, notes } = computeMeasurements(raw, getHeight())
    const keys = Object.keys(values)
    const parts = []
    if (keys.length) {
      parts.push(
        `<p>Получится: ${keys.map((k) => fmt(k, values[k])).join(', ')}.</p>`,
      )
    } else {
      parts.push('<p>Впишите замеры — здесь появятся длины для профиля.</p>')
    }
    for (const e of [...errors, ...notes])
      parts.push(`<p class="merr">${e}</p>`)
    summary.innerHTML = parts.join('')
    document.getElementById('measureApply').disabled = keys.length === 0
    return values
  }

  form.addEventListener('input', update)

  document.getElementById('measureClear').addEventListener('click', () => {
    for (const el of form.elements) {
      if (el.type === 'number') el.value = ''
    }
    update()
  })

  document.getElementById('measureApply').addEventListener('click', () => {
    const values = update()
    if (!Object.keys(values).length) return
    onApply(values)
    dialog.close()
  })

  for (const btn of dialog.querySelectorAll('[data-close-guide]')) {
    btn.addEventListener('click', () => dialog.close())
  }
  // клик по подложке закрывает окно
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })

  for (const btn of document.querySelectorAll('[data-open-guide]')) {
    btn.addEventListener('click', () => {
      update()
      dialog.showModal()
      // прокручиваем только тело окна, шапка и кнопки остаются на месте
      const body = dialog.querySelector('.guide-body')
      const target = document.getElementById(`guide-${btn.dataset.openGuide}`)
      body.scrollTop = 0
      if (btn.dataset.openGuide !== 'body') {
        body.scrollTop =
          target.getBoundingClientRect().top - body.getBoundingClientRect().top
      }
    })
  }

  restore()
  update()
}
