import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import {
  anatomyDims,
  anatomyFrames,
  GROUPS,
  groupLoad,
  MUSCLES,
  musclePaths,
  pathLength,
} from '../js/anatomy.js'
import { buildAnatomy } from '../js/anatomy3d.js'
import { buildBody, DEFAULT_PROFILE } from '../js/anthropometry.js'
import { rigFrame } from '../js/rig3d.js'
import { solveBench, solveDeadlift, solveSquat } from '../js/solver.js'

const P = DEFAULT_PROFILE
const body = buildBody(P)
const SOLVE = { squat: solveSquat, deadlift: solveDeadlift, bench: solveBench }

function prepare(lift, opts = P[lift]) {
  const res = SOLVE[lift](body, opts)
  const rigs = res.frames.map((_, i) => rigFrame(body, res, i, opts))
  const frames = anatomyFrames(lift, rigs)
  const D = anatomyDims(body, lift, rigs, frames)
  return { res, rigs, frames, D }
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const lengthOf = (D, frames, id, i) =>
  pathLength(
    musclePaths(frames[i], D).find((p) => p.m.id === id && p.side === 'R')
      .points,
  )

describe('анатомия: системы координат', () => {
  for (const lift of ['squat', 'deadlift', 'bench']) {
    const { frames } = prepare(lift)
    it(`${lift}: базисы ортонормированы и правые`, () => {
      for (const Fr of frames) {
        for (const [seg, F] of Object.entries(Fr)) {
          for (const v of [F.f, F.up, F.lat])
            assert.ok(Math.abs(dot(v, v) - 1) < 1e-6, seg)
          assert.ok(Math.abs(dot(F.f, F.up)) < 1e-6, seg)
          assert.ok(Math.abs(dot(F.up, F.lat)) < 1e-6, seg)
          const c = cross(F.f, F.up)
          assert.ok(dot(c, F.lat) > 0.999, `${seg}: z = x × y`)
        }
      }
    })
    it(`${lift}: бедро, голень и стопа смотрят наружу той же стороны`, () => {
      for (const Fr of frames) {
        for (const seg of ['TH', 'SH', 'FT'])
          assert.ok(dot(Fr[seg].lat, Fr.T.lat) > 0.5, seg)
      }
    })
  }

  it('в жиме лифтёр лежит лицом вверх', () => {
    const { frames } = prepare('bench')
    for (const Fr of frames) assert.ok(Fr.T.f.y > 0.9)
  })
})

describe('анатомия: мышцы', () => {
  const sq = prepare('squat')
  const dl = prepare('deadlift')
  const bp = prepare('bench')
  const last = (x) => x.frames.length - 1

  it('все точки конечны, левая сторона — зеркало правой', () => {
    for (const { frames, D } of [sq, dl, bp]) {
      for (const Fr of frames) {
        const paths = musclePaths(Fr, D)
        for (let i = 0; i < paths.length; i += 2) {
          const R = paths[i].points
          const L = paths[i + 1].points
          R.forEach((p, j) => {
            assert.ok(Number.isFinite(p.x + p.y + p.z), paths[i].m.id)
            assert.ok(Math.abs(p.z + L[j].z) < 1e-9 && p.x === L[j].x)
          })
        }
      }
    }
  })

  it('у каждой мышцы есть группа из GROUPS или её нет', () => {
    for (const m of MUSCLES)
      assert.ok(!m.group || GROUPS[m.group], `${m.id}: ${m.group}`)
  })

  // Длины мышц меняются как у человека: это проверяет, что точки
  // прикрепления стоят по нужную сторону от суставов.
  // Прямую мышцу бедра не проверяем: она двусуставная, сгибание таза её
  // укорачивает, а колена — удлиняет (парадокс Ломбарда).
  it('присед: широкие мышцы бедра и большая ягодичная удлиняются внизу', () => {
    for (const id of [
      'vastusLateralis',
      'vastusMedialis',
      'vastusIntermedius',
      'gluteusMaxMid',
    ]) {
      const top = lengthOf(sq.D, sq.frames, id, 0)
      const bottom = lengthOf(sq.D, sq.frames, id, last(sq))
      assert.ok(bottom > top, `${id}: ${top} → ${bottom}`)
    }
  })

  it('тяга: задняя поверхность бедра длиннее на старте, чем в локауте', () => {
    for (const id of ['bicepsFemoris', 'semimembranosus']) {
      const start = lengthOf(dl.D, dl.frames, id, 0)
      const lock = lengthOf(dl.D, dl.frames, id, last(dl))
      assert.ok(start > lock + 3, `${id}: ${start} → ${lock}`)
    }
  })

  it('жим: большая грудная растянута у груди и короче в локауте', () => {
    // кадры жима идут от груди (0) к локауту
    const chest = lengthOf(bp.D, bp.frames, 'pectoralisSternal', 0)
    const lock = lengthOf(bp.D, bp.frames, 'pectoralisSternal', last(bp))
    assert.ok(chest > lock + 2, `${chest} → ${lock}`)
  })

  it('нагрузка групп: знак момента выбирает разгибатели или сгибатели', () => {
    assert.equal(groupLoad('quads', { hip: 1, knee: -0.5, ankle: 0 }), 0)
    assert.equal(groupLoad('hamstrings', { hip: 0, knee: -0.5, ankle: 0 }), 0.5)
    assert.equal(groupLoad('pecs', { hip: 1, knee: 1, ankle: 1 }), null)
    assert.equal(groupLoad('triceps', { shoulder: 1, elbow: 0.7 }), 0.7)
  })
})

describe('анатомия: 3D-треки', () => {
  for (const lift of ['squat', 'deadlift', 'bench']) {
    it(`${lift}: каждый трек находит объект и не содержит NaN`, () => {
      const { res, rigs } = prepare(lift)
      const a = buildAnatomy(
        body,
        lift,
        rigs,
        res.frames.map((f) => f.util),
      )
      const tracks = a.tracks(1.6)
      assert.ok(tracks.length >= 28)
      for (const t of tracks) {
        const { nodeName } = THREE.PropertyBinding.parseTrackName(t.name)
        assert.ok(
          THREE.PropertyBinding.findNode(a.group, nodeName),
          `нет объекта для ${t.name}`,
        )
        assert.ok(t.values.every(Number.isFinite), t.name)
        assert.equal(t.times.length, rigs.length)
      }
    })
  }

  for (const lift of ['squat', 'deadlift', 'bench']) {
    it(`${lift}: геометрия мышц конечна в любой фазе и следует за позой`, () => {
      const { res, rigs } = prepare(lift)
      const a = buildAnatomy(
        body,
        lift,
        rigs,
        res.frames.map((f) => f.util),
      )
      const mesh = a.group.getObjectByName('muscles')
      const pos = mesh.geometry.attributes.position
      const snap = []
      for (const phase of [0, 0.37, 1]) {
        a.update(phase)
        assert.ok(pos.array.every(Number.isFinite), `фаза ${phase}`)
        assert.ok(
          mesh.geometry.attributes.normal.array.every(Number.isFinite),
          `нормали, фаза ${phase}`,
        )
        snap.push(pos.array.slice())
      }
      assert.notDeepEqual(snap[0], snap[2])
    })
  }
})
