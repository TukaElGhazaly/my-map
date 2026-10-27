// The thinking roof in 3D: my design from Rhino, the roof sections with their plants, a heat overlay,
// glowing windows, an energy bar above each house and what the roof last said.
import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROOF_COLORS, heatColor } from './colors.js'
import { cover, LIMIT_KW } from './roof.js'

const DESIGN_URL = `${import.meta.env.BASE_URL}data/design.glb`
const toScene = (x, y, h = 0) => [x, h, -y]

// Rhino's glTF export drops transparency; these are the alphas of the Grasshopper colour swatches.
const OPACITY = { 'Railings (glass)': 0.43, 'Roof railing (glass)': 0.43, 'Balcony doors (glass)': 0.82, 'Shop glass': 0.51 }
const GLOWING = 'Balcony doors (glass)'

const inside = (ring, [x, y]) => {
  let a = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) a = !a
  }
  return a
}

// The design, merged into one mesh per colour and house, so it draws quickly.
// glow: per house, a colour for its windows and how strongly they shine.
function Design({ roof, glow }) {
  const { scene } = useGLTF(DESIGN_URL)
  const parts = useMemo(() => {
    const centres = roof.buildings.map((b) => b.outline.reduce(([x, y], p) => [x + p[0] / b.outline.length, y + p[1] / b.outline.length], [0, 0]))
    const groups = new Map()
    scene.updateMatrixWorld(true)
    scene.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
      g.computeBoundingBox()
      const c = g.boundingBox.getCenter(new THREE.Vector3())
      const p = [c.x, -c.z]
      let house = roof.buildings.findIndex((b) => inside(b.outline, p))
      if (house < 0) house = centres.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])).reduce((best, d, k, all) => (d < all[best] ? k : best), 0)
      const key = `${o.material.name}|${house}`
      if (!groups.has(key)) groups.set(key, { name: o.material.name, color: o.material.color.clone(), house, geos: [] })
      groups.get(key).geos.push(g)
    })
    return [...groups.values()].map(({ name, color, house, geos }) => {
      const indexed = geos.every((g) => g.index)
      const geometry = mergeGeometries(indexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)))
      geos.forEach((g) => g.dispose())
      const opacity = OPACITY[name] ?? 1
      const material = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 })
      return { name, house, geometry, material }
    })
  }, [scene, roof])

  useEffect(() => {
    for (const p of parts) {
      if (p.name !== GLOWING) continue
      const g = glow[p.house]
      p.material.emissive.set(g.color)
      p.material.emissiveIntensity = g.strength
    }
  }, [parts, glow])

  useEffect(() => () => parts.forEach((p) => (p.geometry.dispose(), p.material.dispose())), [parts])

  return parts.map((p, k) => <mesh key={k} geometry={p.geometry} material={p.material} raycast={() => null} />)
}

// A few low-poly shrubs per section: three on thin planting, ten on dense. Same places every time.
function plantSpots(s, count) {
  let seed = [...s.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const xs = s.polygon.map((p) => p[0]), ys = s.polygon.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const out = []
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]
    if (inside(s.polygon, p)) out.push({ p, r: 0.35 + rnd() * 0.55, turn: rnd() * Math.PI * 2, shade: rnd() })
  }
  return out
}

function Plants({ sections }) {
  const ref = useRef()
  const spots = useMemo(() => {
    const all = []
    for (const s of sections) {
      const c = cover(s)
      if (c > 0) for (const q of plantSpots(s, c === 1 ? 3 : 10)) all.push({ ...q, z: s.z })
    }
    return all
  }, [sections])
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4(), c = new THREE.Color()
    const dark = new THREE.Color(ROOF_COLORS.plantDark), light = new THREE.Color(ROOF_COLORS.plantLight)
    spots.forEach((q, i) => {
      m.compose(
        new THREE.Vector3(...toScene(q.p[0], q.p[1], q.z + 0.1 + q.r * 0.7)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, q.turn, 0)),
        new THREE.Vector3(q.r, q.r * 0.85, q.r),
      )
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.copy(dark).lerp(light, q.shade))
    })
    mesh.count = spots.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [spots])
  return (
    <instancedMesh ref={ref} args={[null, null, 400]} raycast={() => null} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshLambertMaterial flatShading />
    </instancedMesh>
  )
}

// One flat surface per section, a few centimetres above the roof. Click it to change it.
function Sections({ sections, overlay, range, onSection }) {
  const geometries = useMemo(
    () =>
      sections.map((s) => {
        const g = new THREE.ShapeGeometry(new THREE.Shape(s.polygon.map(([x, y]) => new THREE.Vector2(x, y))))
        g.rotateX(-Math.PI / 2)
        g.translate(0, s.z + 0.05, 0)
        return g
      }),
    [sections.length], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  const outlines = useMemo(() => {
    const pos = []
    for (const s of sections)
      if (s.locked)
        s.polygon.forEach((p, k) => {
          const q = s.polygon[(k + 1) % s.polygon.length]
          pos.push(...toScene(p[0], p[1], s.z + 0.12), ...toScene(q[0], q[1], s.z + 0.12))
        })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [sections])
  useEffect(() => () => outlines.dispose(), [outlines])

  const colorOf = (s) => {
    if (overlay) return heatColor((s.flow / s.area - range[0]) / Math.max(range[1] - range[0], 1e-6))
    if (s.use === 'terrace') return ROOF_COLORS.terrace
    if (s.use === 'path') return ROOF_COLORS.path
    return [ROOF_COLORS.bare, ROOF_COLORS.thin, ROOF_COLORS.dense][s.cover]
  }

  return (
    <>
      {sections.map((s, k) => (
        <mesh
          key={s.id}
          geometry={geometries[k]}
          onClick={(e) => {
            if (e.delta > 4) return // a drag to orbit, not a click
            e.stopPropagation()
            onSection(s.id, [e.point.x, -e.point.z], s.z)
          }}
        >
          <meshLambertMaterial color={colorOf(s)} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <lineSegments geometry={outlines} raycast={() => null}>
        <lineBasicMaterial color={ROOF_COLORS.locked} />
      </lineSegments>
    </>
  )
}

// A bench on every terrace section.
function Benches({ sections }) {
  const terraces = sections.filter((s) => s.use === 'terrace')
  return terraces.map((s) => {
    const angle = Math.atan2(s.normal[1], s.normal[0])
    return (
      <mesh key={s.id} position={toScene(s.centre[0], s.centre[1], s.z + 0.3)} rotation={[0, angle + Math.PI / 2, 0]} raycast={() => null}>
        <boxGeometry args={[1.8, 0.45, 0.5]} />
        <meshLambertMaterial color={ROOF_COLORS.bench} />
      </mesh>
    )
  })
}

// The line being drawn.
function Drawing({ points }) {
  const geometry = useMemo(() => {
    const pos = []
    for (let i = 1; i < points.length; i++) pos.push(...toScene(points[i - 1][0], points[i - 1][1], points[i - 1][2] + 0.4), ...toScene(points[i][0], points[i][1], points[i][2] + 0.4))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [points])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <>
      <lineSegments geometry={geometry} raycast={() => null} renderOrder={6}>
        <lineBasicMaterial color={ROOF_COLORS.drawing} depthTest={false} />
      </lineSegments>
      {points.map((p, k) => (
        <mesh key={k} position={toScene(p[0], p[1], p[2] + 0.4)} raycast={() => null} renderOrder={6}>
          <sphereGeometry args={[0.35, 10, 8]} />
          <meshBasicMaterial color={ROOF_COLORS.drawing} depthTest={false} />
        </mesh>
      ))}
    </>
  )
}

// Fly the camera to the site the first time the view opens.
function Approach({ roof }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!controls) return
    const xs = roof.site.map((p) => p[0]), ys = roof.site.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    controls.target.set(cx, 8, -cy)
    camera.position.set(cx - 70, 75, -cy + 85)
    controls.update()
  }, [controls]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function RoofScene({ roof, roofState, overlay, onSection, drawing, glow, lastSay }) {
  const { now, clock, passive } = roofState
  const per = now.sections.map((s) => s.flow / s.area)
  const range = [Math.min(...per), Math.max(...per)]
  return (
    <>
      <Approach roof={roof} />
      <Design roof={roof} glow={glow} />
      <Sections sections={now.sections} overlay={overlay} range={range} onSection={onSection} />
      <Plants sections={now.sections} />
      <Benches sections={now.sections} />
      {drawing.length > 0 && <Drawing points={drawing} />}
      {roof.buildings.map((b, k) => {
        const c = b.outline.reduce(([x, y], p) => [x + p[0] / b.outline.length, y + p[1] / b.outline.length], [0, 0])
        const m = now.buildings[k]
        const share = Math.min(1, m.load / 1000 / (LIMIT_KW * 1.5))
        return (
          <Html key={k} position={toScene(c[0], c[1], b.roof_z + 7)} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className="roof-bar">
              <div className="roof-bar-name">{b.name}</div>
              <div className="roof-bar-track">
                <div className="roof-bar-fill" style={{ width: `${share * 100}%`, background: glow[k].bar }} />
              </div>
              <div className="roof-bar-value">
                {m.heatingOff ? 'heating off · ' : ''}
                {(m.load / 1000).toFixed(1)} kW {clock.mode === 'heating' ? (passive ? 'heat loss' : 'heating') : 'overheating'}
              </div>
            </div>
          </Html>
        )
      })}
      {lastSay && (
        <Html position={toScene(roof.buildings[0].outline[0][0], roof.buildings[0].outline[0][1], roof.buildings[0].roof_z + 14)} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="roof-says">{lastSay}</div>
        </Html>
      )}
    </>
  )
}

