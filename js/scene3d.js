// 3D-сцена: процедурный манекен, штанга, скамья. Кадры решателя
// «запекаются» в AnimationClip (треки положения и кватернионов сегментов)
// и проигрываются AnimationMixer'ом в режиме LoopPingPong.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildAnatomy } from './anatomy3d.js'
import { CONSTANTS } from './solver.js'
import { MARKERS, rigFrame, SEGMENTS, widths } from './rig3d.js'

const { PLATE_R, BAR_R, BENCH_TOP } = CONSTANTS
const CM = 0.01 // вся модель строится в сантиметрах внутри группы со scale 0.01
const DURATION = 1.6 // секунд на один ход (вниз или вверх)

const COLORS = {
  background: 0xe4e7ea,
  flesh: 0xcfd6de,
  ink: 0x1b2430,
  red: 0xc42530,
  blue: 0x1f4fb5,
  yellow: 0xd49a00,
  green: 0x2b8655,
  steel: 0x7d8692,
  bench: 0x39414c,
}

const VIEWS = {
  side: { dir: [0, 0.12, 1], dist: 3.3 },
  front: { dir: [1, 0.15, 0], dist: 3.3 },
  threeQuarter: { dir: [0.75, 0.38, 0.9], dist: 3.5 },
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const X_AXIS = new THREE.Vector3(1, 0, 0)

// Ориентация сегмента: локальная ось Y вдоль A→B, Z — как можно ближе к
// мировой поперечной оси, чтобы сплющенные капсулы торса смотрели вбок.
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
function segmentQuaternion(a, b, out) {
  _y.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize()
  const ref = Math.abs(_y.dot(Z_AXIS)) > 0.9 ? X_AXIS : Z_AXIS
  _x.crossVectors(_y, ref).normalize()
  _z.crossVectors(_x, _y)
  _m.makeBasis(_x, _y, _z)
  return out.setFromRotationMatrix(_m)
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh || o.isLine) {
      o.geometry.dispose()
      for (const m of [o.material].flat()) m.dispose()
    }
  })
}

export class LiftScene {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(COLORS.background)
    this.scene.fog = new THREE.Fog(COLORS.background, 9, 22)

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.495 // не уходить под пол
    this.controls.minDistance = 1.2
    this.controls.maxDistance = 9

    this.#lights()
    this.#floor()

    this.root = null // группа текущего упражнения
    this.mixer = null
    this.action = null
    this.playing = true
    this.onFrame = null
    this.look = 'anatomy' // или 'mannequin'

    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.renderer.setAnimationLoop(() => this.#tick())

    this.resizeObserver = new ResizeObserver(() => this.#resize())
    this.resizeObserver.observe(canvas)
  }

  #lights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(2.5, 5, 3.5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const c = sun.shadow.camera
    c.left = -2.5
    c.right = 2.5
    c.top = 2.5
    c.bottom = -2.5
    c.near = 0.5
    c.far = 15
    sun.shadow.bias = -0.0004
    this.scene.add(sun)
  }

  #floor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    // помост 4×4 м, как на соревнованиях
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.02, 4),
      new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.9 }),
    )
    platform.position.y = -0.0099
    platform.receiveShadow = true
    this.scene.add(platform)
    const grid = new THREE.GridHelper(4, 8, 0xaab1b9, 0xbcc2c8)
    grid.position.y = 0.002
    this.scene.add(grid)
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  #tick() {
    this.timer.update()
    const delta = this.timer.getDelta()
    if (this.mixer && this.playing) this.mixer.update(delta)
    if (this.anatomy?.visible) this.updateMuscles(this.phase)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    if (this.action && this.onFrame) this.onFrame(this.phase)
  }

  // 0 — стартовая позиция, 1 — точка разворота. Берётся из своего трека,
  // а не из action.time: в LoopPingPong на обратном проходе three.js
  // показывает позу для (DURATION − time), а time хранит непрямое значение.
  get phase() {
    return this.clock?.phase ?? 0
  }

  setPlaying(on) {
    this.playing = on
  }

  scrub(phase) {
    if (!this.action) return
    this.playing = false
    // сброс счётчика петель, иначе на обратном проходе поза отразится
    this.action.reset()
    this.action.time = THREE.MathUtils.clamp(phase, 0, 1) * DURATION
    this.mixer.update(0) // применить позу без продвижения времени
  }

  // close — во сколько раз ближе (для крупных планов по ссылке)
  setView(name, close = 1) {
    const v = VIEWS[name]
    if (!v || !this.target) return
    const dir = new THREE.Vector3(...v.dir).normalize()
    this.camera.position
      .copy(this.target)
      .addScaledVector(dir, (v.dist * this.zoom) / close)
    this.controls.target.copy(this.target)
    this.controls.update()
  }

  setBarPath(visible) {
    if (this.barPath) this.barPath.visible = visible
  }

  // Манекен или анатомия: в анатомии кожа становится полупрозрачной
  // оболочкой, а цветные шарниры прячутся — их место занимают мышцы.
  setLook(look) {
    this.look = look
    if (!this.root) return
    const anatomy = look === 'anatomy'
    this.anatomy.visible = anatomy
    this.markers.visible = !anatomy
    const m = this.flesh
    m.transparent = anatomy
    m.opacity = anatomy ? 0.13 : 1
    m.depthWrite = !anatomy
    m.needsUpdate = true
    // блины почти прозрачные, чтобы сбоку было видно мышцы
    this.plateMat.opacity = anatomy ? 0.16 : 0.55
    for (const mesh of this.mannequin.children) mesh.castShadow = !anatomy
  }

  // Построить манекен под тело и упражнение и запечь анимацию
  setResult(body, res, opts) {
    const keepTime = this.phase * DURATION
    if (this.root) {
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.root)
      this.scene.remove(this.root)
      disposeTree(this.root)
    }
    const root = new THREE.Group()
    root.scale.setScalar(CM)
    this.root = root
    this.scene.add(root)

    // жим: кадры идут снизу вверх, а повтор начинается в локауте
    const order = res.frames.map((_, i) => i)
    if (res.lift === 'bench') order.reverse()
    const rigs = order.map((i) => rigFrame(body, res, i, opts))
    const k = body.height / 178

    const mat = (color, rough = 0.75) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough })
    const flesh = mat(COLORS.flesh, 0.85)
    this.flesh = flesh
    const mannequin = new THREE.Group()
    mannequin.name = 'mannequin'
    this.mannequin = mannequin
    root.add(mannequin)
    const markerGroup = new THREE.Group()
    markerGroup.name = 'markers'
    this.markers = markerGroup
    root.add(markerGroup)

    // сегменты
    const first = rigs[0].joints
    for (const [name, a, b, r, depth, width] of SEGMENTS) {
      const length = first[a] && first[b] ? distance(first[a], first[b]) : 10
      const radius = r * k
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, Math.max(0.1, length), 6, 18),
        flesh,
      )
      mesh.name = `seg_${name}`
      mesh.scale.set(depth, 1, width)
      mesh.castShadow = true
      mannequin.add(mesh)
    }
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(body.height * 0.058, 24, 16),
      flesh,
    )
    head.name = 'seg_head'
    head.scale.set(0.95, 1.08, 0.85)
    head.castShadow = true
    mannequin.add(head)

    // цветные шарниры
    const markers = res.lift === 'bench' ? MARKERS.bench : MARKERS.standing
    const markerColors = {
      hip: COLORS.red,
      knee: COLORS.blue,
      ankle: COLORS.yellow,
    }
    for (const [kind, names] of Object.entries(markers)) {
      for (const n of names) {
        // видны сквозь тело, как на рентгене: это главное, на что смотреть
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(3.6 * k, 16, 12),
          new THREE.MeshBasicMaterial({
            color: markerColors[kind],
            depthTest: false,
            transparent: true,
          }),
        )
        m.renderOrder = 10
        m.name = `j_${n}`
        markerGroup.add(m)
      }
    }

    // штанга
    const bar = this.#barbell(opts.load, res.lift)
    bar.name = 'barbell'
    root.add(bar)

    if (res.lift === 'bench') root.add(this.#bench(body))

    // траектория грифа — с той стороны, что ближе к камере сбоку
    const pathPts = rigs.map((r) => new THREE.Vector3(r.bar.x, r.bar.y, 112))
    this.barPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pathPts),
      new THREE.LineDashedMaterial({
        color: COLORS.green,
        dashSize: 2,
        gapSize: 2,
      }),
    )
    this.barPath.computeLineDistances()
    root.add(this.barPath)

    // запекание: один ключевой кадр на кадр решателя
    const n = rigs.length
    const times = rigs.map((_, i) => (i / (n - 1)) * DURATION)
    // часы фазы: тот же проигрыш, что у позы, включая обратный проход
    const clock = new THREE.Object3D()
    clock.name = 'phaseClock'
    clock.phase = 0
    root.add(clock)
    this.clock = clock
    const tracks = [
      new THREE.NumberKeyframeTrack(
        'phaseClock.phase',
        times,
        times.map((t) => t / DURATION),
      ),
    ]
    const q = new THREE.Quaternion()
    for (const [name, a, b] of SEGMENTS) {
      const pos = []
      const rot = []
      for (const { joints, offsets } of rigs) {
        const A = joints[a]
        const B = joints[b]
        const off = offsets[name] ?? { x: 0, y: 0, z: 0 }
        pos.push(
          (A.x + B.x) / 2 + off.x,
          (A.y + B.y) / 2 + off.y,
          (A.z + B.z) / 2 + off.z,
        )
        segmentQuaternion(A, B, q)
        rot.push(q.x, q.y, q.z, q.w)
      }
      tracks.push(
        new THREE.VectorKeyframeTrack(`seg_${name}.position`, times, pos),
      )
      tracks.push(
        new THREE.QuaternionKeyframeTrack(`seg_${name}.quaternion`, times, rot),
      )
    }
    const headPos = []
    const headRot = []
    for (const { joints } of rigs) {
      headPos.push(joints.head.x, joints.head.y, joints.head.z)
      segmentQuaternion(joints.headBase, joints.head, q)
      headRot.push(q.x, q.y, q.z, q.w)
    }
    tracks.push(
      new THREE.VectorKeyframeTrack('seg_head.position', times, headPos),
    )
    tracks.push(
      new THREE.QuaternionKeyframeTrack('seg_head.quaternion', times, headRot),
    )
    for (const names of Object.values(markers)) {
      for (const jn of names) {
        const pos = rigs.flatMap(({ joints }) => [
          joints[jn].x,
          joints[jn].y,
          joints[jn].z,
        ])
        tracks.push(
          new THREE.VectorKeyframeTrack(`j_${jn}.position`, times, pos),
        )
      }
    }
    tracks.push(
      new THREE.VectorKeyframeTrack(
        'barbell.position',
        times,
        rigs.flatMap((r) => [r.bar.x, r.bar.y, r.bar.z]),
      ),
    )

    // анатомия: кости по системам сегментов, мышцы между прикреплениями
    const anatomy = buildAnatomy(
      body,
      res.lift,
      rigs,
      order.map((i) => res.frames[i].util),
    )
    this.anatomy = anatomy.group
    this.updateMuscles = anatomy.update
    root.add(anatomy.group)
    tracks.push(...anatomy.tracks(DURATION))

    const clip = new THREE.AnimationClip(res.lift, DURATION, tracks)
    this.mixer = new THREE.AnimationMixer(root)
    this.action = this.mixer.clipAction(clip)
    this.action.setLoop(THREE.LoopPingPong, Infinity)
    this.action.play()
    this.action.time = Math.min(keepTime, DURATION)
    this.mixer.update(0)

    // камера: центр сцены по высоте фигуры
    const W = widths(body, res.lift, opts)
    const prevTarget = this.target
    this.zoom = body.height / 178
    this.target =
      res.lift === 'bench'
        ? new THREE.Vector3(-0.25, 0.75, 0)
        : new THREE.Vector3(0, body.height * 0.45 * CM, 0)
    if (!prevTarget) this.setView('threeQuarter')
    else {
      // сохранить ракурс пользователя, сдвинув его вместе с целью
      const offset = this.camera.position.clone().sub(this.controls.target)
      this.controls.target.copy(this.target)
      this.camera.position.copy(this.target).add(offset)
    }
    this.widths = W
    this.setLook(this.look)
  }

  #barbell(load, lift) {
    const g = new THREE.Group()
    const steel = new THREE.MeshStandardMaterial({
      color: COLORS.steel,
      metalness: 0.8,
      roughness: 0.35,
    })
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(BAR_R, BAR_R, 220, 16),
      steel,
    )
    shaft.rotation.x = Math.PI / 2
    shaft.castShadow = true
    g.add(shaft)
    // 25-килограммовые блины: по (вес − гриф 20) / 2 / 25 на сторону
    const perSide = Math.max(1, Math.round(((load ?? 100) - 20) / 50))
    // полупрозрачные, чтобы в виде сбоку не закрывали фигуру (как в 2D)
    const plateMat = new THREE.MeshStandardMaterial({
      color: COLORS.red,
      roughness: 0.6,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    this.plateMat = plateMat
    for (const sg of [-1, 1]) {
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.5, 44, 16),
        steel,
      )
      sleeve.rotation.x = Math.PI / 2
      sleeve.position.z = sg * 88
      g.add(sleeve)
      for (let i = 0; i < Math.min(perSide, 8); i++) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(PLATE_R, PLATE_R, 2.7, 40),
          plateMat,
        )
        plate.rotation.x = Math.PI / 2
        plate.position.z = sg * (68 + i * 2.9)
        plate.castShadow = true
        g.add(plate)
      }
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(4, 4, 4, 16),
        steel,
      )
      collar.rotation.x = Math.PI / 2
      collar.position.z = sg * (68 + Math.min(perSide, 8) * 2.9 + 1)
      g.add(collar)
    }
    if (lift === 'squat') g.renderOrder = 1
    return g
  }

  #bench(body) {
    const g = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({
      color: COLORS.bench,
      roughness: 0.8,
    })
    const len = body.L.torso + 70
    const pad = new THREE.Mesh(new THREE.BoxGeometry(len, 6, 30), m)
    pad.position.set(-body.L.torso - 18 + len / 2, BENCH_TOP - 3, 0)
    pad.castShadow = true
    pad.receiveShadow = true
    g.add(pad)
    for (const x of [-body.L.torso, 20]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(6, BENCH_TOP - 6, 26), m)
      leg.position.set(x, (BENCH_TOP - 6) / 2, 0)
      leg.castShadow = true
      g.add(leg)
    }
    return g
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
