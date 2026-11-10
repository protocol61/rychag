import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildBody, DEFAULT_PROFILE } from '../js/anthropometry.js'
import { solveBench, solveDeadlift, solveSquat } from '../js/solver.js'

const P = DEFAULT_PROFILE
const body = buildBody(P)
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
const maxStep = (frames, get) =>
  Math.max(...frames.slice(1).map((f, i) => Math.abs(get(f) - get(frames[i]))))

describe('антропометрия', () => {
  it('массы сегментов в сумме дают массу тела', () => {
    const total = Object.values(body.m).reduce((s, v) => s + v, 0)
    assert.ok(Math.abs(total - P.weight) < 0.01 * P.weight)
  })

  it('свой замер заменяет оценку по росту', () => {
    const b = buildBody({ ...P, segments: { ...P.segments, thigh: 50 } })
    assert.equal(b.L.thigh, 50)
    assert.equal(b.estimated.thigh, false)
    assert.equal(b.estimated.shin, true)
  })
})

describe('присед', () => {
  const res = solveSquat(body, P.squat)
  const bottom = res.frames.at(-1).pose

  it('центр масс всё время над серединой стопы', () => {
    for (const f of res.frames) assert.ok(Math.abs(f.moments.comX) < 0.2)
  })

  it('длины звеньев сохраняются', () => {
    for (const { pose } of res.frames) {
      assert.ok(Math.abs(dist(pose.H, pose.S) - body.L.torso) < 1e-6)
    }
  })

  it('доходит до глубины по правилам: таз ниже колена', () => {
    assert.ok(bottom.H.y < bottom.K.y)
  })

  it('голеностоп не выходит за предел подвижности', () => {
    for (const f of res.frames) {
      assert.ok(f.angles.ankle <= body.mobility.ankle + 1e-9)
    }
  })

  it('низкий гриф даёт больший наклон торса при тех же моментах', () => {
    const high = solveSquat(body, { ...P.squat, barPosition: 'high' })
    const low = solveSquat(body, { ...P.squat, barPosition: 'low' })
    assert.ok(low.summary.bottom.trunk > high.summary.bottom.trunk + 3)
    const dh = Math.abs(
      low.summary.peakMoments.hip - high.summary.peakMoments.hip,
    )
    assert.ok(dh < 0.02 * high.summary.peakMoments.hip)
  })

  it('длинное бедро при том же росте — больше наклон вперёд', () => {
    const longFemur = buildBody({
      ...P,
      segments: { ...P.segments, thigh: 48, torso: 48 },
    })
    const r = solveSquat(longFemur, P.squat)
    assert.ok(r.summary.bottom.trunk > res.summary.bottom.trunk)
  })
})

describe('становая тяга', () => {
  const conv = solveDeadlift(body, P.deadlift)
  const sumo = solveDeadlift(body, { ...P.deadlift, style: 'sumo' })

  it('стартует с пола и доходит до локаута', () => {
    assert.equal(conv.frames.length, 61)
    assert.ok(Math.abs(conv.frames[0].bar.y - 22.5) < 1e-9)
    const top = conv.frames.at(-1)
    // Плечо над грифом при отвесных руках, а таз над голеностопом (позади
    // середины стопы) — торс в локауте наклонён на ~8°, угол таза ~15°
    assert.ok(top.angles.knee < 10 && top.angles.hip < 20)
  })

  it('гриф не проходит сквозь ноги', () => {
    for (const f of conv.frames.slice(0, -3)) {
      assert.ok(f.violations.shin < 1.5, `кадр ${f.t}: ${f.violations.shin}`)
    }
  })

  it('движение плавное, без скачков колена', () => {
    assert.ok(maxStep(conv.frames, (f) => f.pose.K.x) < 3)
    assert.ok(maxStep(sumo.frames, (f) => f.pose.K.x) < 3)
  })

  it('в сумо таз ниже, а спина вертикальнее', () => {
    assert.ok(sumo.summary.hipHeight < conv.summary.hipHeight)
    assert.ok(sumo.summary.start.trunk < conv.summary.start.trunk)
    assert.ok(sumo.summary.peakMoments.hip < conv.summary.peakMoments.hip)
  })
})

describe('жим лёжа', () => {
  const res = solveBench(body, P.bench)

  it('руки сохраняют длину', () => {
    const Lf = body.L.forearm + body.L.grip
    for (const { pose } of res.frames) {
      const [ex, ey, ez] = pose.E3
      const up = Math.hypot(ex, ey - res.geo.yS, ez - pose.s)
      const fore = Math.hypot(pose.B.x - ex, pose.B.y - ey, pose.g - ez)
      assert.ok(Math.abs(up - body.L.upperArm) < 0.05)
      assert.ok(Math.abs(fore - Lf) < 0.05)
    }
  })

  it('в локауте гриф над плечевым суставом', () => {
    assert.ok(Math.abs(res.frames.at(-1).bar.x) < 0.3)
  })

  it('подобранный хват в пределах правил IPF', () => {
    assert.ok(res.summary.gripAuto)
    assert.ok(res.summary.grip <= 81)
  })

  it('прогиб сокращает путь грифа', () => {
    assert.ok(res.summary.rom < res.summary.romFlat)
    const more = solveBench(body, { ...P.bench, arch: 10 })
    assert.ok(more.summary.rom < res.summary.rom)
  })
})

describe('коллизии грифа с ногами в тяге', () => {
  for (const style of ['conventional', 'sumo']) {
    it(`${style}: гриф не входит в голень и бедро (капсулы 3D-модели)`, () => {
      const r = solveDeadlift(body, { ...P.deadlift, style })
      for (const f of r.frames) {
        assert.ok(
          f.violations.shin < 0.1,
          `высота ${f.bar.y}: ${f.violations.shin}`,
        )
      }
    })
  }

  it('с длинными бёдрами и короткими руками гриф всё равно обходит ноги', () => {
    const b = buildBody({
      ...P,
      segments: { ...P.segments, thigh: 50, upperArm: 30, forearm: 24 },
    })
    const r = solveDeadlift(b, P.deadlift)
    for (const f of r.frames) assert.ok(f.violations.shin < 0.1)
  })
})
