// Антропометрия: длины сегментов, массы и центры масс.
//
// Длины сегментов, если человек их не измерил, оцениваются от роста
// по пропорциям Drillis & Contini (1966) в изложении Winter
// (Biomechanics and Motor Control of Human Movement, 4th ed., fig. 4.1).
// Массы и положения центров масс сегментов взяты у de Leva (1996),
// "Adjustments to Zatsiorsky-Seluyanov's segment inertia parameters".

// Доли роста
export const PROPORTIONS = {
  foot: 0.152, // пятка — носок
  ankleH: 0.039, // высота голеностопа над полом
  shin: 0.246, // щель коленного сустава — лодыжка
  thigh: 0.245, // большой вертел — щель коленного сустава
  torso: 0.288, // большой вертел — акромион
  headNeck: 0.182, // акромион — макушка
  upperArm: 0.186, // акромион — локоть
  forearm: 0.146, // локоть — запястье
  hand: 0.108, // запястье — кончик среднего пальца
  shoulderW: 0.259, // биакромиальная ширина
}

// de Leva (1996): доли массы тела и положение ЦМ от проксимального конца
const SEGMENTS = {
  m: {
    headNeck: 0.0694,
    trunk: 0.4346,
    upperArm: 0.0271,
    forearm: 0.0162,
    hand: 0.0061,
    thigh: 0.1416,
    shank: 0.0433,
    foot: 0.0137,
    trunkComFromTop: 0.4486,
    thighComFromHip: 0.4095,
    shankComFromKnee: 0.4459,
  },
  f: {
    headNeck: 0.0668,
    trunk: 0.4257,
    upperArm: 0.0255,
    forearm: 0.0138,
    hand: 0.0056,
    thigh: 0.1478,
    shank: 0.0481,
    foot: 0.0129,
    trunkComFromTop: 0.4151,
    thighComFromHip: 0.3612,
    shankComFromKnee: 0.4416,
  },
}

// Что пользователь может ввести сам (остальное только оценивается)
export const MEASURABLE = [
  'thigh',
  'shin',
  'torso',
  'upperArm',
  'forearm',
  'foot',
]

export const DEFAULT_PROFILE = {
  sex: 'm',
  height: 178,
  weight: 85,
  segments: {
    thigh: null,
    shin: null,
    torso: null,
    upperArm: null,
    forearm: null,
    foot: null,
  },
  mobility: { ankle: 35, hip: 135 },
  squat: { load: 140, barPosition: 'low', stance: 30, depth: 3 },
  bench: { load: 100, arch: 5, grip: null, flare: 50, path: 'optimal' },
  deadlift: { load: 180, style: 'conventional', sumoStance: 45 },
}

export function estimateSegment(height, key) {
  return +(height * PROPORTIONS[key]).toFixed(1)
}

// Профиль → тело модели: длины (см), массы (кг), доли ЦМ.
export function buildBody(profile) {
  const H = profile.height
  const W = profile.weight
  const seg = SEGMENTS[profile.sex] ?? SEGMENTS.m

  const L = {}
  const estimated = {}
  for (const key of Object.keys(PROPORTIONS)) {
    const measured = profile.segments?.[key]
    if (measured && measured > 0) {
      L[key] = measured
      estimated[key] = false
    } else {
      L[key] = H * PROPORTIONS[key]
      estimated[key] = true
    }
  }
  // Точка хвата — примерно 38 % кисти от запястья (ось грифа в ладони)
  L.grip = 0.38 * L.hand

  const m = {
    headNeck: seg.headNeck * W,
    trunk: seg.trunk * W,
    arms: 2 * (seg.upperArm + seg.forearm + seg.hand) * W,
    thighs: 2 * seg.thigh * W,
    shanks: 2 * seg.shank * W,
    feet: 2 * seg.foot * W,
  }

  return {
    height: H,
    weight: W,
    L,
    m,
    estimated,
    com: {
      trunkFromHip: 1 - seg.trunkComFromTop,
      thighFromHip: seg.thighComFromHip,
      shankFromKnee: seg.shankComFromKnee,
    },
    mobility: { ...DEFAULT_PROFILE.mobility, ...profile.mobility },
  }
}
