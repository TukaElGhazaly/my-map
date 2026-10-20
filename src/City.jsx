// The 3D city: ground, buildings, streets, landmarks, and whatever a view adds on top.
import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { REACH_COLORS, GROUND_COLOR, BACKGROUND_COLOR, STREET_COLOR } from './colors.js'

// Map metres (x east, y north) to the 3D scene (x east, y up, -z north).
const toScene = (x, y, h = 0) => [x, h, -y]

function shapeFrom(outer, holes) {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

// All buildings in one mesh. Each building keeps track of its vertices, so its colour can change.
function useBuildingGeometry(buildings) {
  return useMemo(() => {
    const parts = []
    const ranges = []
    let count = 0
    for (const b of buildings) {
      let g
      try {
        g = new THREE.ExtrudeGeometry(shapeFrom(b.rings[0], b.rings.slice(1)), {
          depth: Math.max(b.height, 0.5),
          bevelEnabled: false,
        })
      } catch {
        g = null
      }
      const n = g ? g.attributes.position.count : 0
      ranges.push([count, n])
      if (g) parts.push(g)
      count += n
    }
    const position = new Float32Array(count * 3)
    const normal = new Float32Array(count * 3)
    let offset = 0
    for (const g of parts) {
      position.set(g.attributes.position.array, offset)
      normal.set(g.attributes.normal.array, offset)
      offset += g.attributes.position.array.length
      g.dispose()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.rotateX(-Math.PI / 2) // footprints lie on the ground, height points up
    geometry.computeBoundingSphere()
    return { geometry, ranges }
  }, [buildings])
}

// Which building a vertex belongs to.
function buildingAtVertex(ranges, v) {
  let lo = 0, hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[mid][0] <= v) lo = mid
    else hi = mid - 1
  }
  return lo
}

// `colors`: one colour per building, as '#rrggbb'.
function Buildings({ colors, buildings, meshRef }) {
  const { geometry, ranges } = useBuildingGeometry(buildings)

  useEffect(() => {
    const array = geometry.attributes.color.array
    const cache = new Map()
    colors.forEach((hex, i) => {
      if (!cache.has(hex)) cache.set(hex, new THREE.Color(hex))
      const c = cache.get(hex)
      const [start, n] = ranges[i]
      for (let v = start; v < start + n; v++) {
        array[v * 3] = c.r
        array[v * 3 + 1] = c.g
        array[v * 3 + 2] = c.b
      }
    })
    geometry.attributes.color.needsUpdate = true
  }, [geometry, ranges, colors])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh ref={meshRef} geometry={geometry} userData={{ ranges }}>
      <meshLambertMaterial vertexColors />
    </mesh>
  )
}

function Streets({ net }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const e of net.edges)
      for (let i = 1; i < e.pts.length; i++) pos.push(...toScene(...e.pts[i - 1], 1.2), ...toScene(...e.pts[i], 1.2))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [net])
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={STREET_COLOR} />
    </lineSegments>
  )
}

// The three walking areas, flat on the ground: the largest lowest and lightest, the smallest on top.
export function ReachAreas({ levels }) {
  const geometries = useMemo(
    () =>
      levels.map((level) => {
        const g = new THREE.ShapeGeometry(level.shapes.map((s) => shapeFrom(s.outer, s.holes)))
        g.rotateX(-Math.PI / 2)
        return g
      }),
    [levels],
  )
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  return geometries.map((g, i) => (
    <mesh key={i} geometry={g} position={[0, 0.6 - i * 0.2, 0]} raycast={() => null}>
      <meshBasicMaterial
        color={REACH_COLORS[i]}
        polygonOffset
        polygonOffsetFactor={-1 - (levels.length - i)}
        polygonOffsetUnits={-4 * (levels.length - i)}
      />
    </mesh>
  ))
}

export function StartMarker({ start }) {
  return (
    <group position={toScene(start.x, start.y)}>
      <mesh position={[0, 15, 0]} raycast={() => null}>
        <cylinderGeometry args={[1.2, 1.2, 30, 12]} />
        <meshBasicMaterial color='#3b1209' />
      </mesh>
      <mesh position={[0, 31, 0]} raycast={() => null}>
        <sphereGeometry args={[4, 16, 12]} />
        <meshBasicMaterial color='#3b1209' />
      </mesh>
    </group>
  )
}

// A picture laid on the ground: one coloured pixel per grid cell (used by the heat view).
export function GroundImage({ grid, rgba, cell }) {
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(rgba, grid.nx, grid.ny, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.NearestFilter
    t.needsUpdate = true
    return t
  }, [grid, rgba])
  useEffect(() => () => texture.dispose(), [texture])
  const w = grid.nx * cell, h = grid.ny * cell
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[grid.x0 + w / 2, 0.3, -(grid.y0 + h / 2)]} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
    </mesh>
  )
}

// A straight band on the ground between two points (the transect).
export function GroundLine({ from, to, width = 3, color = '#1c1c1c' }) {
  const [ax, ay] = from, [bx, by] = to
  const length = Math.hypot(bx - ax, by - ay)
  const angle = Math.atan2(by - ay, bx - ax)
  return (
    <mesh position={[(ax + bx) / 2, 1.6, -(ay + by) / 2]} rotation={[-Math.PI / 2, 0, angle]} raycast={() => null}>
      <planeGeometry args={[length, width]} />
      <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-8} />
    </mesh>
  )
}

// Street segments as flat coloured bands on the ground. colors and widths: one per segment.
export function StreetRibbons({ net, colors, widths }) {
  const geometry = useMemo(() => {
    const pos = [], col = []
    const c = new THREE.Color()
    net.edges.forEach((e, k) => {
      c.set(colors[k])
      const half = widths[k] / 2
      for (let i = 1; i < e.pts.length; i++) {
        const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i]
        const l = Math.hypot(bx - ax, by - ay) || 1
        const ox = (-(by - ay) / l) * half, oy = ((bx - ax) / l) * half
        const quad = [[ax + ox, ay + oy], [ax - ox, ay - oy], [bx - ox, by - oy], [bx + ox, by + oy]]
        for (const k2 of [0, 1, 2, 0, 2, 3]) {
          pos.push(...toScene(quad[k2][0], quad[k2][1], 1.4))
          col.push(c.r, c.g, c.b)
        }
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return g
  }, [net, colors, widths])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
    </mesh>
  )
}

// Junctions as small discs, one colour each.
export function NodeDots({ net, colors, radius = 4 }) {
  const ref = useRef()
  useEffect(() => {
    const mesh = ref.current
    const m = new THREE.Matrix4(), c = new THREE.Color()
    net.nodes.forEach((n, i) => {
      m.makeTranslation(n.x, 2.5, -n.y)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(colors[i]))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [net, colors])
  return (
    <instancedMesh ref={ref} args={[null, null, net.nodes.length]} raycast={() => null}>
      <cylinderGeometry args={[radius, radius, 1.5, 14]} />
      <meshBasicMaterial />
    </instancedMesh>
  )
}

// Straight links between points, e.g. buildings that share a wall. lines: [[x1, y1, h1, x2, y2, h2], …]
export function LinkLines({ lines, color = '#1c1c1c' }) {
  const geometry = useMemo(() => {
    const pos = []
    for (const [x1, y1, h1, x2, y2, h2] of lines) pos.push(...toScene(x1, y1, h1), ...toScene(x2, y2, h2))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [lines])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry} raycast={() => null} renderOrder={5}>
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.85} />
    </lineSegments>
  )
}

// A text label drawn into a small image that always faces the camera and keeps its size on screen.
function Label({ text, position }) {
  const { texture, aspect } = useMemo(() => {
    const scale = 3
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const font = `600 ${12 * scale}px system-ui, sans-serif`
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width + 16 * scale)
    const h = 22 * scale
    canvas.width = w
    canvas.height = h
    ctx.fillStyle = '#2b2b2b'
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, 5 * scale)
    ctx.fill()
    ctx.font = font
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 8 * scale, h / 2 + scale)
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    return { texture: t, aspect: w / h }
  }, [text])
  useEffect(() => () => texture.dispose(), [texture])
  const size = 0.024 // height on screen, as a share of the view
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} center={[0.5, 0]} renderOrder={10} raycast={() => null}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  )
}

function Landmarks({ landmarks }) {
  return landmarks.map((l) => <Label key={l.label} text={l.label} position={toScene(l.x, l.y, l.h + 4)} />)
}

function Ground({ size, onPick, buildingsRef }) {
  const [w, h] = size
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        if (e.delta > 4) return // that was a drag to orbit, not a click
        e.stopPropagation()
        // A click on a building picks that building, at the spot below the click.
        let point = e.point
        let building = null
        const mesh = buildingsRef.current
        if (mesh) {
          const hit = new THREE.Raycaster(e.ray.origin, e.ray.direction).intersectObject(mesh, false)[0]
          if (hit && hit.distance < e.distance) {
            point = hit.point
            building = buildingAtVertex(mesh.userData.ranges, hit.face.a)
          }
        }
        onPick(point.x, -point.z, building)
      }}
    >
      <planeGeometry args={[w + 600, h + 600]} />
      <meshBasicMaterial color={GROUND_COLOR} />
    </mesh>
  )
}

export default function City({ data, colors, landmarks, onPick, children }) {
  const buildingsRef = useRef()
  const span = Math.max(...data.size)
  return (
    <Canvas
      flat
      camera={{ position: [-500, span * 0.95, span * 0.75], fov: 40, near: 5, far: span * 10 }}
      style={{ background: BACKGROUND_COLOR }}
    >
      {/* Roofs come out close to their legend colour, walls a little darker. */}
      <ambientLight intensity={2.0} />
      <directionalLight position={[-600, 1200, 400]} intensity={1.4} />
      <Ground size={data.size} onPick={onPick} buildingsRef={buildingsRef} />
      <Streets net={data.net} />
      <Buildings buildings={data.buildings} colors={colors} meshRef={buildingsRef} />
      <Landmarks landmarks={landmarks} />
      {children}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.15} minDistance={60} maxDistance={span * 3} />
    </Canvas>
  )
}
