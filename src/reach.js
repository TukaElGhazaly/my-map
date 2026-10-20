// The walk: from a clicked point along the street network, the areas reached
// in 5, 10 and 15 minutes, the buildings they touch and the residents inside.
import ClipperLib from 'clipper-lib'

export const WALK_M_PER_MIN = 80 // 4.8 km/h
export const BAND_M = 25 // on each side of a street segment
export const MINUTES = [5, 10, 15]
export const SNAP_M = 100 // the furthest a click may be from a street node

const SCALE = 100 // Clipper works in whole numbers, so shapes go in as centimetres
const ARC_TOLERANCE_M = 0.25 // how closely the round band ends follow a true circle

// ---------- the network ----------

export function prepareNetwork(graph, project) {
  const index = new Map()
  const nodes = graph.nodes.map((n, i) => {
    index.set(n.id, i)
    const [x, y] = project([n.lon, n.lat])
    return { x, y, walkable: false }
  })
  const adj = nodes.map(() => [])
  const edges = []
  for (const e of graph.edges) {
    if (!e.walkable) continue
    const a = index.get(e.from)
    const b = index.get(e.to)
    const pts = e.coords.map(project)
    // Distance along the drawn line, so a cut at "40% of the length" lands at 40% of the drawing.
    const cum = [0]
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const k = edges.length
    edges.push({ a, b, length: e.length, pts, cum })
    adj[a].push(k)
    adj[b].push(k)
    nodes[a].walkable = true
    nodes[b].walkable = true
  }
  return { nodes, adj, edges }
}

export function nearestWalkableNode(net, x, y) {
  let best = -1
  let bestD = Infinity
  net.nodes.forEach((n, i) => {
    if (!n.walkable) return
    const d = Math.hypot(n.x - x, n.y - y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return bestD <= SNAP_M ? { node: best, distance: bestD } : null
}

// Shortest walking distance in metres from the start to every node (Dijkstra).
function walkDistances(net, start, maxDist) {
  const dist = new Float64Array(net.nodes.length).fill(Infinity)
  dist[start] = 0
  const heap = [[0, start]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, u] = pop()
    if (d > dist[u] || d > maxDist) continue
    for (const k of net.adj[u]) {
      const e = net.edges[k]
      const v = e.a === u ? e.b : e.a
      const nd = d + e.length
      if (nd < dist[v]) {
        dist[v] = nd
        push([nd, v])
      }
    }
  }
  return dist
}

// The part of an edge's drawing between two shares (0..1) of its length.
function cutLine(edge, t0, t1) {
  const { pts, cum } = edge
  const total = cum[cum.length - 1]
  const s0 = t0 * total, s1 = t1 * total
  const at = (s) => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const seg = cum[i] - cum[i - 1] || 1
    const f = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg))
    const p = pts[i - 1], q = pts[i]
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
  }
  const out = [at(s0)]
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i])
  out.push(at(s1))
  return out
}

// The street pieces reachable within `budget` metres, including the reachable
// part of each last edge, walked in from either end.
function reachedLines(net, dist, budget) {
  const lines = []
  for (const e of net.edges) {
    const fromA = Math.min(e.length, Math.max(0, budget - dist[e.a]))
    const fromB = Math.min(e.length, Math.max(0, budget - dist[e.b]))
    if (fromA + fromB >= e.length) lines.push(e.pts)
    else {
      if (fromA > 0) lines.push(cutLine(e, 0, fromA / e.length))
      if (fromB > 0) lines.push(cutLine(e, 1 - fromB / e.length, 1))
    }
  }
  return lines
}

// ---------- the area: a 25 m band around the lines, joined into one shape ----------

const toPath = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
const fromPath = (path) => path.map(({ X, Y }) => [X / SCALE, Y / SCALE])
const pathArea = (paths) => paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE)
const boxesOverlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const { ptSubject, ptClip } = ClipperLib.PolyType
const { pftNonZero } = ClipperLib.PolyFillType

function bboxOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return [minX, minY, maxX, maxY]
}

// The 25 m band around one line: a strip with round ends.
function bandOf(line) {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_M * SCALE)
  co.AddPath(toPath(line), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  const paths = []
  co.Execute(paths, BAND_M * SCALE)
  const [x0, y0, x1, y1] = bboxOfPoints(line)
  return { paths, bbox: [x0 - BAND_M, y0 - BAND_M, x1 + BAND_M, y1 + BAND_M] }
}

function union(a, b, into = []) {
  const c = new ClipperLib.Clipper()
  c.AddPaths(a, ptSubject, true)
  c.AddPaths(b, ptClip, true)
  c.Execute(ClipperLib.ClipType.ctUnion, into, pftNonZero, pftNonZero)
  return into
}

// Join all bands into one shape. Neighbours are joined first, then pairs of pairs,
// which is much faster than joining everything at once.
function joinBands(bands) {
  const order = bands
    .map((b) => ({ paths: b.paths, key: Math.floor(b.bbox[0] / 100) * 100000 + b.bbox[1] }))
    .sort((p, q) => p.key - q.key)
  let parts = order.map((b) => b.paths)
  while (parts.length > 2) {
    const next = []
    for (let i = 0; i < parts.length; i += 2) next.push(i + 1 < parts.length ? union(parts[i], parts[i + 1]) : parts[i])
    parts = next
  }
  const tree = union(parts[0] ?? [], parts[1] ?? [], new ClipperLib.PolyTree())
  // Outlines with their holes, in metres, for drawing.
  const shapes = ClipperLib.JS.PolyTreeToExPolygons(tree).map((ex) => ({
    outer: fromPath(ex.outer),
    holes: ex.holes.map(fromPath),
  }))
  return { paths: ClipperLib.Clipper.PolyTreeToPaths(tree), shapes }
}

// ---------- residents ----------

// Inside one cell, the area is the bands near that cell; where they overlap they count once.
function residentsIn(bands, cells) {
  let sum = 0
  let withoutFigure = 0
  let overlapping = 0
  for (const cell of cells) {
    const near = bands.filter((b) => boxesOverlap(b.bbox, cell.bbox))
    if (!near.length) continue
    const c = new ClipperLib.Clipper()
    const cellPath = toPath(cell.ring)
    c.AddPath(cellPath, ptSubject, true)
    for (const b of near) c.AddPaths(b.paths, ptClip, true)
    const inside = []
    c.Execute(ClipperLib.ClipType.ctIntersection, inside, pftNonZero, pftNonZero)
    const insideArea = pathArea(inside)
    if (insideArea <= 0) continue
    overlapping++
    if (cell.population == null) {
      withoutFigure++
      continue
    }
    const share = Math.min(1, insideArea / Math.abs(pathArea([cellPath])))
    sum += cell.population * share
  }
  return { residents: Math.round(sum / 10) * 10, exact: sum, withoutFigure, overlapping }
}

// ---------- buildings that touch the area ----------
// A building touches the band exactly when it comes within 25 m of a reached line.

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function segSegDist(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegDist(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointSegDist(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegDist(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointSegDist(d[0], d[1], a[0], a[1], b[0], b[1]),
  )
}

function insideRings(rings, x, y) {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

const GRID_M = 50

function segmentGrid(lines) {
  const grid = new Map()
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i]
      const seg = [a, b]
      const x0 = Math.floor(Math.min(a[0], b[0]) / GRID_M), x1 = Math.floor(Math.max(a[0], b[0]) / GRID_M)
      const y0 = Math.floor(Math.min(a[1], b[1]) / GRID_M), y1 = Math.floor(Math.max(a[1], b[1]) / GRID_M)
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = gx + ',' + gy
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(seg)
        }
    }
  return grid
}

function touches(building, grid) {
  const [minX, minY, maxX, maxY] = building.bbox
  const seen = new Set()
  for (let gx = Math.floor((minX - BAND_M) / GRID_M); gx <= Math.floor((maxX + BAND_M) / GRID_M); gx++)
    for (let gy = Math.floor((minY - BAND_M) / GRID_M); gy <= Math.floor((maxY + BAND_M) / GRID_M); gy++) {
      const segs = grid.get(gx + ',' + gy)
      if (!segs) continue
      for (const seg of segs) {
        if (seen.has(seg)) continue
        seen.add(seg)
        const [a, b] = seg
        if (insideRings(building.rings, a[0], a[1])) return true
        for (const ring of building.rings)
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
            if (segSegDist(a, b, ring[j], ring[i]) <= BAND_M) return true
      }
    }
  return false
}

// ---------- everything for one click ----------

export function computeReach(net, buildings, cells, x, y) {
  const start = nearestWalkableNode(net, x, y)
  if (!start) return { start: null }
  const maxBudget = MINUTES[MINUTES.length - 1] * WALK_M_PER_MIN
  const dist = walkDistances(net, start.node, maxBudget)

  // For each building: the index of the smallest area it touches, or -1.
  const levelOf = new Int8Array(buildings.length).fill(-1)
  let candidates = buildings.map((_, i) => i)
  const levels = []
  // From the largest area inwards: a building can only touch a smaller area if it touches the larger one.
  for (let li = MINUTES.length - 1; li >= 0; li--) {
    const minutes = MINUTES[li]
    const lines = reachedLines(net, dist, minutes * WALK_M_PER_MIN)
    const bands = lines.map(bandOf)
    const area = joinBands(bands)
    const reachBox = bands.reduce((m, b) => [Math.min(m[0], b.bbox[0]), Math.min(m[1], b.bbox[1]), Math.max(m[2], b.bbox[2]), Math.max(m[3], b.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity])
    const grid = segmentGrid(lines)
    candidates = candidates.filter((i) => boxesOverlap(buildings[i].bbox, reachBox) && touches(buildings[i], grid))
    for (const i of candidates) levelOf[i] = li
    levels[li] = {
      minutes,
      shapes: area.shapes,
      areaM2: pathArea(area.paths),
      buildings: candidates.length,
      ...residentsIn(bands, cells),
    }
  }
  const n = net.nodes[start.node]
  return { start: { x: n.x, y: n.y, snapDistance: start.distance }, levels, levelOf }
}
