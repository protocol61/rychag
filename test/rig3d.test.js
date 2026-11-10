import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildBody, DEFAULT_PROFILE } from '../js/anthropometry.js'
import { dist3, rigFrame, SEGMENTS } from '../js/rig3d.js'
import { solveBench, solveDeadlift, solveSquat } from '../js/solver.js'

const P = DEFAULT_PROFILE
const body = buildBody(P)
const cases = [
  ['присед', solveSquat(body, P.squat), P.squat],
  ['тяга классика', solveDeadlift(body, P.deadlift), P.deadlift],
  [
    'тяга сумо',
    solveDeadlift(body, { ...P.deadlift, style: 'sumo' }),
    { ...P.deadlift, style: 'sumo' },
  ],
  ['жим', solveBench(body, P.bench), P.bench],
]

describe('3D-риг', () => {
  for (const [name, res, opts] of cases) {
    describe(name, () => {
      const rigs = res.frames.map((_, i) => rigFrame(body, res, i, opts))

      it('все суставы сегментов на месте и конечны', () => {
        for (const { joints } of rigs) {
          for (const [, a, b] of SEGMENTS) {
            for (const p of [joints[a], joints[b]]) {
              assert.ok(p && Number.isFinite(p.x + p.y + p.z), `${a}/${b}`)
            }
          }
        }
      })

      it('левая и правая стороны зеркальны', () => {
        for (const { joints } of rigs) {
          for (const j of ['knee', 'hand', 'elbow', 'ankle']) {
            const L = joints[`${j}L`]
            const R = joints[`${j}R`]
            assert.ok(Math.abs(L.x - R.x) < 1e-9 && Math.abs(L.z + R.z) < 1e-9)
          }
        }
      })

      it('длины бедра, голени и рук держатся (±2 см)', () => {
        const Lfa = body.L.forearm + body.L.grip
        const tol = name === 'тяга сумо' ? 6 : 2 // широкая стойка: ногу у локаута выпрямляем
        for (const { joints: j } of rigs) {
          assert.ok(Math.abs(dist3(j.kneeL, j.ankleL) - body.L.shin) < tol)
          assert.ok(Math.abs(dist3(j.hipL, j.kneeL) - body.L.thigh) < tol)
          assert.ok(
            Math.abs(dist3(j.shoulderL, j.elbowL) - body.L.upperArm) < 2,
          )
          assert.ok(Math.abs(dist3(j.elbowL, j.handL) - Lfa) < 2)
        }
      })

      it('стопы на полу, ничего не уходит под пол', () => {
        for (const { joints } of rigs) {
          assert.ok(joints.toeL.y < 3 && joints.heelL.y < 3)
          for (const p of Object.values(joints)) assert.ok(p.y > -0.5)
        }
      })
    })
  }
})
