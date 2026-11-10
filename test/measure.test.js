import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeMeasurements } from '../js/measure.js'

describe('замеры', () => {
  it('длины — разности высот от пола', () => {
    const { values, errors } = computeMeasurements(
      { acromion: '146', trochanter: '94.5', knee: '51', malleolus: '7' },
      178,
    )
    assert.deepEqual(errors, [])
    assert.equal(values.torso, 51.5)
    assert.equal(values.thigh, 43.5)
    assert.equal(values.shin, 44)
  })

  it('угол от горизонтали переводится в угол от вертикали', () => {
    const v = (ref) =>
      computeMeasurements({ ankleReading: '55', ankleRef: ref }).values.ankle
    assert.equal(v('horizontal'), 35)
    // 55° от вертикали — за пределом 10–50°, значение отбрасывается
    assert.equal(v('vertical'), undefined)
  })

  it('угол бедро — торс = 180 − угол на фото', () => {
    assert.equal(computeMeasurements({ hipPhoto: '45' }).values.hip, 135)
  })

  it('перепутанные отметки дают ошибку, а не отрицательную длину', () => {
    const { values, errors } = computeMeasurements({
      trochanter: '50',
      knee: '52',
    })
    assert.equal(values.thigh, undefined)
    assert.equal(errors.length, 1)
  })

  it('пустые поля пропускаются', () => {
    const { values, errors } = computeMeasurements({ foot: '', upperArm: '33' })
    assert.deepEqual(values, { upperArm: 33 })
    assert.deepEqual(errors, [])
  })

  it('предупреждает, если акромион не сходится с ростом', () => {
    const { notes } = computeMeasurements({ acromion: '120' }, 178)
    assert.equal(notes.length, 1)
  })
})
