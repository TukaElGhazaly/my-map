// The topology of the city: how streets, buildings, blocks, courtyards and green spaces
// are connected to each other, rather than how far apart they are.
// Everything here is measured from the city kit; nothing is assumed except the
// thresholds named below.

import { CELL_M } from './heat.js'

// ---------- a small priority queue ----------

class Heap {
  constructor() {
    this.items = []
  }
  get size() {
    return this.items.length
  }
  push(key, value) {
    const h = this.items
    h.push([key, value])
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (h[p][0] <= h[i][0]) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }
  pop() {
    const h = this.items
    const top = h[0]
    const last = h.pop()
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < h.length && h[l][0] < h[m][0]) m = l
        if (r < h.length && h[r][0] < h[m][0]) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]
        i = m
      }
    }
    return top
  }
}

// ---------- streets: degree, angular integration and choice ----------
// Space syntax "angular segment analysis": every street segment is a node of a new graph.
// Going from one segment to the next costs the angle you turn (90° costs 1, straight on costs 0).
// Integration: how few turns it takes to reach all other segments (central, easy to find).
// Choice: how often a segment lies on the simplest route between two others (through-movement).

export const RADII = {
  n: { label: 'whole network', metres: Infinity },
  r800: { label: '800 m', metres: 800 },
}

function direction(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1]
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

// For each segment: the segments it meets, the turn (angular cost) and the distance between their middles.
function segmentGraph(net) {
  const links = net.edges.map(() => new Map())
  net.adj.forEach((edgesHere, v) => {
    // The direction in which each segment leaves this node.
    const leaving = edgesHere.map((k) => {
      const e = net.edges[k]
      const pts = e.pts
      return e.a === v ? direction(pts[0], pts[1]) : direction(pts[pts.length - 1], pts[pts.length - 2])
    })
    for (let x = 0; x < edgesHere.length; x++)
      for (let y = 0; y < edgesHere.length; y++) {
        const k = edgesHere[x], m = edgesHere[y]
        if (k === m) continue
        // Arriving along k means moving opposite to its leaving direction.
        const dot = -leaving[x][0] * leaving[y][0] - leaving[x][1] * leaving[y][1]
        const turn = Math.acos(Math.max(-1, Math.min(1, dot)))
        const angular = turn / (Math.PI / 2)
        const metric = (net.edges[k].length + net.edges[m].length) / 2
        const old = links[k].get(m)
        if (!old || angular < old[0]) links[k].set(m, [angular, metric])
      }
  })
  return links.map((l) => [...l.entries()].map(([m, [angular, metric]]) => ({ m, angular, metric })))
}

function syntaxAtRadius(net, links, radius) {
  const n = net.edges.length
  const total = new Float64Array(n) // total angular depth to all segments in reach
  const count = new Uint32Array(n) // segments in reach
  const choice = new Float64Array(n)
  const inReach = new Int32Array(n).fill(-1)
  const metricDist = new Float64Array(n)
  const dist = new Float64Array(n)
  const sigma = new Float64Array(n)
  const delta = new Float64Array(n)
  const preds = Array.from({ length: n }, () => [])
  const EPS = 1e-9

  for (let s = 0; s < n; s++) {
    // Which segments lie within the radius, walking from the middle of s.
    if (Number.isFinite(radius)) {
      metricDist.fill(Infinity)
      metricDist[s] = 0
      const heap = new Heap()
      heap.push(0, s)
      while (heap.size) {
        const [d, u] = heap.pop()
        if (d > metricDist[u]) continue
        inReach[u] = s
        for (const { m, metric } of links[u]) {
          const nd = d + metric
          if (nd <= radius && nd < metricDist[m]) {
            metricDist[m] = nd
            heap.push(nd, m)
          }
        }
      }
    } else inReach.fill(s)

    // Simplest routes (fewest degrees of turning) from s, counting how many there are (Brandes).
    dist.fill(Infinity)
    sigma.fill(0)
    dist[s] = 0
    sigma[s] = 1
    const order = []
    const heap = new Heap()
    heap.push(0, s)
    const done = new Uint8Array(n)
    while (heap.size) {
      const [d, u] = heap.pop()
      if (done[u] || d > dist[u] + EPS) continue
      done[u] = 1
      order.push(u)
      for (const { m, angular } of links[u]) {
        if (inReach[m] !== s) continue
        const nd = d + angular
        if (nd < dist[m] - EPS) {
          dist[m] = nd
          sigma[m] = sigma[u]
          preds[m] = [u]
          heap.push(nd, m)
        } else if (Math.abs(nd - dist[m]) <= EPS) {
          sigma[m] += sigma[u]
          preds[m].push(u)
        }
      }
    }
    let td = 0
    for (const u of order) td += dist[u]
    total[s] = td
    count[s] = order.length
    delta.fill(0)
    for (let k = order.length - 1; k > 0; k--) {
      const w = order[k]
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w])
      choice[w] += delta[w]
    }
    for (const u of order) preds[u] = []
  }
  // Normalised as in Hillier, Yang and Turner (2012), so different radii can be compared.
  const integration = Array.from(total, (td, s) => Math.pow(count[s], 1.2) / (td + 2))
  const choiceNorm = Array.from(choice, (c, s) => Math.log(c / 2 + 1) / Math.log(total[s] + 3))
  return { integration, choice: Array.from(choice, (c) => c / 2), choiceNorm, count: Array.from(count) }
}

export function streetSyntax(net) {
  const links = segmentGraph(net)
  const degree = net.adj.map((a) => a.length)
  const radii = {}
  for (const [key, r] of Object.entries(RADII)) radii[key] = syntaxAtRadius(net, links, r.metres)
  return { degree, radii }
}

// ---------- the grid: street space, buildings, yards and enclosed courtyards ----------

export const CELL = { building: 0, street: 1, yard: 2, courtyard: 3 }

// Blocks are the land between streets. Open ground inside a block that can't be reached
// from the street without going through a building is an enclosed courtyard.
export function blocksAndCourtyards(grid) {
  const { nx, ny, n } = grid
  // Ground outside the plots (street space, or no data near the edge of the kit) is outside every block.
  const outside = new Set([grid.coverKeys.indexOf('street'), grid.coverKeys.indexOf('unknown')])
  const cls = new Uint8Array(n)
  for (let c = 0; c < n; c++) cls[c] = grid.height[c] > 0 ? CELL.building : outside.has(grid.cover[c]) ? CELL.street : CELL.yard

  const neighbours4 = (c, visit) => {
    const i = c % nx, j = (c / nx) | 0
    if (i > 0) visit(c - 1)
    if (i < nx - 1) visit(c + 1)
    if (j > 0) visit(c - nx)
    if (j < ny - 1) visit(c + nx)
  }
  const atEdge = (c) => {
    const i = c % nx, j = (c / nx) | 0
    return i === 0 || j === 0 || i === nx - 1 || j === ny - 1
  }

  // Open ground: does it reach the street (or the edge of the kit) without crossing a building?
  const openId = new Int32Array(n).fill(-1)
  const courtyards = []
  for (let c0 = 0; c0 < n; c0++) {
    if (cls[c0] !== CELL.yard || openId[c0] >= 0) continue
    const id = courtyards.length
    const cells = [c0]
    openId[c0] = id
    let open = false
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k]
      if (atEdge(c)) open = true
      neighbours4(c, (d) => {
        if (cls[d] === CELL.street) open = true
        else if (cls[d] === CELL.yard && openId[d] < 0) {
          openId[d] = id
          cells.push(d)
        }
      })
    }
    courtyards.push({ cells, enclosed: !open })
  }
  for (const ct of courtyards) if (ct.enclosed) for (const c of ct.cells) cls[c] = CELL.courtyard
  const enclosed = courtyards.filter((ct) => ct.enclosed).map((ct) => ({ cells: ct.cells.length, area: ct.cells.length * CELL_M * CELL_M }))

  // Blocks: everything that is not street space, joined where it touches.
  const blockId = new Int32Array(n).fill(-1)
  const streetEdge = new Uint8Array(n) // 1 where a block meets the street
  const blocks = []
  for (let c0 = 0; c0 < n; c0++) {
    if (cls[c0] === CELL.street || blockId[c0] >= 0) continue
    const id = blocks.length
    const cells = [c0]
    blockId[c0] = id
    let built = 0, edge = 0, edgeBuilt = 0, courtyardCells = 0
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k]
      if (cls[c] === CELL.building) built++
      if (cls[c] === CELL.courtyard) courtyardCells++
      let onStreet = false
      neighbours4(c, (d) => {
        if (cls[d] === CELL.street) onStreet = true
        else if (blockId[d] < 0) {
          blockId[d] = id
          cells.push(d)
        }
      })
      if (onStreet) {
        streetEdge[c] = 1
        edge++
        if (cls[c] === CELL.building) edgeBuilt++
      }
    }
    blocks.push({
      cells: cells.length,
      area: cells.length * CELL_M * CELL_M,
      coverage: built / cells.length, // share of the block covered by buildings
      continuity: edge ? edgeBuilt / edge : 0, // share of the street edge that is building
      courtyardArea: courtyardCells * CELL_M * CELL_M,
    })
  }
  return { cls, blockId, streetEdge, blocks, courtyards: enclosed }
}

// ---------- buildings: party walls and what each facade faces ----------

const TOUCH_M = 0.5 // walls closer than this touch
const GRID_M = 20

export function buildingAdjacency(buildings, grid, cls) {
  // All wall edges in a grid, to find touching walls quickly.
  const hash = new Map()
  const edges = []
  buildings.forEach((b, i) => {
    b.rings.forEach((ring, r) => {
      const area = ring.reduce((s, p, k) => {
        const q = ring[(k + 1) % ring.length]
        return s + p[0] * q[1] - q[0] * p[1]
      }, 0)
      const outwardRight = r === 0 ? area > 0 : area < 0
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length]
        const e = { i, p, q, outwardRight, shared: [] }
        edges.push(e)
        const x0 = Math.floor((Math.min(p[0], q[0]) - TOUCH_M) / GRID_M), x1 = Math.floor((Math.max(p[0], q[0]) + TOUCH_M) / GRID_M)
        const y0 = Math.floor((Math.min(p[1], q[1]) - TOUCH_M) / GRID_M), y1 = Math.floor((Math.max(p[1], q[1]) + TOUCH_M) / GRID_M)
        for (let gx = x0; gx <= x1; gx++)
          for (let gy = y0; gy <= y1; gy++) {
            const key = gx + ',' + gy
            if (!hash.has(key)) hash.set(key, [])
            hash.get(key).push(e)
          }
      }
    })
  })

  const pairs = new Map() // "i,j" → shared wall length in metres
  const facade = buildings.map(() => ({ party: 0, street: 0, yard: 0, courtyard: 0 }))
  for (const e of edges) {
    const { p, q } = e
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len < 0.01) continue
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len
    const touching = []
    const seen = new Set()
    const x0 = Math.floor((Math.min(p[0], q[0]) - TOUCH_M) / GRID_M), x1 = Math.floor((Math.max(p[0], q[0]) + TOUCH_M) / GRID_M)
    const y0 = Math.floor((Math.min(p[1], q[1]) - TOUCH_M) / GRID_M), y1 = Math.floor((Math.max(p[1], q[1]) + TOUCH_M) / GRID_M)
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++)
        for (const f of hash.get(gx + ',' + gy) ?? []) {
          if (f.i === e.i || seen.has(f)) continue
          seen.add(f)
          const fx = f.q[0] - f.p[0], fy = f.q[1] - f.p[1]
          const flen = Math.hypot(fx, fy)
          if (flen < 0.01 || Math.abs(ux * fy - uy * fx) / flen > 0.1) continue
          const off = (pt) => Math.abs((pt[0] - p[0]) * uy - (pt[1] - p[1]) * ux)
          if (off(f.p) > TOUCH_M || off(f.q) > TOUCH_M) continue
          const t1 = (f.p[0] - p[0]) * ux + (f.p[1] - p[1]) * uy
          const t2 = (f.q[0] - p[0]) * ux + (f.q[1] - p[1]) * uy
          const a = Math.max(0, Math.min(t1, t2)), c = Math.min(len, Math.max(t1, t2))
          if (c - a > 0.1) touching.push([a, c, f.i])
        }
    // Length of this edge that touches another building (overlaps counted once).
    touching.sort((m, k) => m[0] - k[0])
    let shared = 0, end = 0
    for (const [a, c, j] of touching) {
      const from = Math.max(a, end)
      if (c > from) {
        shared += c - from
        end = c
      }
      const key = e.i < j ? `${e.i},${j}` : `${j},${e.i}`
      pairs.set(key, Math.max(pairs.get(key) ?? 0, c - a))
    }
    facade[e.i].party += shared
    // The rest of the edge faces whatever lies 2 m outside its middle.
    const rest = len - shared
    if (rest <= 0.01) continue
    const nxv = e.outwardRight ? uy : -uy, nyv = e.outwardRight ? -ux : ux
    const mx = (p[0] + q[0]) / 2 + nxv * 2, my = (p[1] + q[1]) / 2 + nyv * 2
    const gi = Math.floor((mx - grid.x0) / CELL_M), gj = Math.floor((my - grid.y0) / CELL_M)
    const kind = gi < 0 || gj < 0 || gi >= grid.nx || gj >= grid.ny ? CELL.street : cls[gj * grid.nx + gi]
    if (kind === CELL.street) facade[e.i].street += rest
    else if (kind === CELL.courtyard) facade[e.i].courtyard += rest
    else if (kind === CELL.yard) facade[e.i].yard += rest
    else facade[e.i].party += rest // squeezed against another building
  }

  // Groups of buildings joined by party walls (terraces, perimeter blocks).
  const links = [...pairs.entries()].filter(([, l]) => l >= 1).map(([key, length]) => {
    const [i, j] = key.split(',').map(Number)
    return { i, j, length }
  })
  const neighbours = buildings.map(() => 0)
  const parent = buildings.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const { i, j } of links) {
    neighbours[i]++
    neighbours[j]++
    parent[find(i)] = find(j)
  }
  const groupSize = new Map()
  buildings.forEach((_, i) => groupSize.set(find(i), (groupSize.get(find(i)) ?? 0) + 1))
  const group = buildings.map((_, i) => find(i))
  return { links, neighbours, group, groupSize: buildings.map((_, i) => groupSize.get(group[i])), facade }
}

// ---------- canyons: the height and width of the street space around each segment ----------

const RAY_M = 40 // look this far to each side for a wall
const ENCLOSED_M = 25 // a wall within this distance encloses the street

export function streetCanyons(net, grid) {
  const hit = (x, y, dx, dy) => {
    for (let d = 1; d <= RAY_M; d += 1) {
      const i = Math.floor((x + dx * d - grid.x0) / CELL_M), j = Math.floor((y + dy * d - grid.y0) / CELL_M)
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return null
      const h = grid.height[j * grid.nx + i]
      if (h > 0) return { d, h }
    }
    return null
  }
  return net.edges.map((e) => {
    let both = 0, hw = 0, sides = 0, enclosedSides = 0, heights = 0, heightCount = 0
    for (let k = 1; k < e.pts.length; k++) {
      const p = e.pts[k - 1], q = e.pts[k]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      const ux = (q[0] - p[0]) / (len || 1), uy = (q[1] - p[1]) / (len || 1)
      for (let s = 2; s < len; s += 4) {
        const x = p[0] + ux * s, y = p[1] + uy * s
        const left = hit(x, y, -uy, ux), right = hit(x, y, uy, -ux)
        for (const side of [left, right]) {
          sides++
          if (side && side.d <= ENCLOSED_M) enclosedSides++
          if (side) {
            heights += side.h
            heightCount++
          }
        }
        if (left && right) {
          both++
          hw += (left.h + right.h) / 2 / (left.d + right.d)
        }
      }
    }
    return {
      hw: both ? hw / both : 0, // height ÷ width where walls stand on both sides
      enclosure: sides ? enclosedSides / sides : 0, // share of the edges lined by a wall within 25 m
      height: heightCount ? heights / heightCount : 0,
    }
  })
}

// ---------- green and blue patches and their connections ----------

export const GREEN_KEYS = ['recreation', 'cemetery', 'wasteland']
export const BLUE_KEYS = ['flowing water', 'standing water']
export const GAPS = { g10: { label: '10 m', metres: 10 }, g30: { label: '30 m', metres: 30 }, g60: { label: '60 m', metres: 60 }, g100: { label: '100 m', metres: 100 } }
const MAX_GAP = 100

export function greenPatches(grid) {
  const { nx, ny, n } = grid
  const kindOf = grid.coverKeys.map((k) => (GREEN_KEYS.includes(k) ? 1 : BLUE_KEYS.includes(k) ? 2 : 0))
  const isPatch = (c) => grid.height[c] === 0 && kindOf[grid.cover[c]] > 0
  const patchId = new Int32Array(n).fill(-1)
  const patches = []
  for (let c0 = 0; c0 < n; c0++) {
    if (!isPatch(c0) || patchId[c0] >= 0) continue
    const id = patches.length
    const cells = [c0]
    patchId[c0] = id
    const border = []
    let green = 0, blue = 0, sx = 0, sy = 0
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k]
      const i = c % nx, j = (c / nx) | 0
      if (kindOf[grid.cover[c]] === 1) green++
      else blue++
      sx += i
      sy += j
      let edge = false
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          const ii = i + di, jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const d = jj * nx + ii
          if (!isPatch(d)) edge = true
          else if (patchId[d] < 0) {
            patchId[d] = id
            cells.push(d)
          }
        }
      if (edge) border.push(c)
    }
    patches.push({
      area: cells.length * CELL_M * CELL_M,
      kind: blue === 0 ? 'green' : green === 0 ? 'blue' : 'green and blue',
      x: grid.x0 + (sx / cells.length + 0.5) * CELL_M,
      y: grid.y0 + (sy / cells.length + 0.5) * CELL_M,
      border,
    })
  }
  // Removing single cells that are slivers of a plot edge keeps the patch count meaningful.
  const MIN_AREA = 4 * CELL_M * CELL_M

  // The shortest gap between every two patches up to 100 m, and where it is.
  const bucket = 32
  const buckets = new Map()
  patches.forEach((p, id) => {
    if (p.area < MIN_AREA) return
    for (const c of p.border) {
      const i = c % nx, j = (c / nx) | 0
      const key = Math.floor(i / bucket) + ',' + Math.floor(j / bucket)
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push([id, i, j])
    }
  })
  const reach = Math.ceil(MAX_GAP / CELL_M)
  const best = new Map()
  for (const [key, items] of buckets) {
    const [bx, by] = key.split(',').map(Number)
    const span = Math.ceil(reach / bucket)
    for (let ox = -span; ox <= span; ox++)
      for (let oy = -span; oy <= span; oy++) {
        const other = buckets.get(bx + ox + ',' + (by + oy))
        if (!other) continue
        for (const [a, ia, ja] of items)
          for (const [b, ib, jb] of other) {
            if (b <= a) continue
            const gap = (Math.hypot(ia - ib, ja - jb) - 1) * CELL_M // edge to edge
            if (gap > MAX_GAP) continue
            const k = a + ',' + b
            const old = best.get(k)
            if (!old || gap < old.gap) best.set(k, { a, b, gap: Math.max(0, gap), from: [ia, ja], to: [ib, jb] })
          }
      }
  }
  const toXY = ([i, j]) => [grid.x0 + (i + 0.5) * CELL_M, grid.y0 + (j + 0.5) * CELL_M]
  const links = [...best.values()].map((l) => ({ ...l, from: toXY(l.from), to: toXY(l.to) }))
  const kept = patches.map((p) => p.area >= MIN_AREA)
  return { patchId, patches: patches.map((p) => ({ area: p.area, kind: p.kind, x: p.x, y: p.y })), kept, links }
}

// Patches closer than the gap form one network.
export function greenNetworks(green, gap) {
  const { patches, kept, links } = green
  const parent = patches.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const used = links.filter((l) => l.gap <= gap)
  for (const l of used) parent[find(l.a)] = find(l.b)
  const area = new Map(), count = new Map()
  patches.forEach((p, i) => {
    if (!kept[i]) return
    const r = find(i)
    area.set(r, (area.get(r) ?? 0) + p.area)
    count.set(r, (count.get(r) ?? 0) + 1)
  })
  const networks = [...area.entries()].map(([root, a]) => ({ root, area: a, patches: count.get(root) })).sort((x, y) => y.area - x.area)
  const rank = new Map(networks.map((nw, k) => [nw.root, k]))
  const total = networks.reduce((s, nw) => s + nw.area, 0)
  return {
    networkOf: patches.map((_, i) => (kept[i] ? rank.get(find(i)) : -1)),
    networks,
    links: used,
    largestShare: networks.length ? networks[0].area / total : 0,
    isolated: networks.filter((nw) => nw.patches === 1).length,
    patchCount: kept.filter(Boolean).length,
    totalArea: total,
  }
}

// ---------- along the transect ----------

export function distanceToLine([ax, ay], [bx, by], x, y) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

export const CORRIDOR_M = 200 // on each side of the transect

// The same figures for the corridor along the transect and for the whole kit.
export function compareCorridor({ net, buildings, grid, syntax, canyons, blocks, adjacency, green, from, to }) {
  const inside = (x, y) => distanceToLine(from, to, x, y) <= CORRIDOR_M
  const result = {}
  for (const where of ['corridor', 'all']) {
    const keep = where === 'all' ? () => true : inside
    // Streets
    const segs = net.edges.map((e, k) => k).filter((k) => {
      const p = net.edges[k].pts
      return keep((p[0][0] + p.at(-1)[0]) / 2, (p[0][1] + p.at(-1)[1]) / 2)
    })
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN)
    const median = (arr) => (arr.length ? [...arr].sort((a, b) => a - b)[arr.length >> 1] : NaN)
    const nodes = net.nodes.map((nd, v) => v).filter((v) => keep(net.nodes[v].x, net.nodes[v].y))
    let cells = 0, ground = 0, edge = 0, edgeBuilt = 0, courtyard = 0, greenCells = 0
    for (let c = 0; c < grid.n; c++) {
      const x = grid.x0 + ((c % grid.nx) + 0.5) * CELL_M, y = grid.y0 + (((c / grid.nx) | 0) + 0.5) * CELL_M
      if (!keep(x, y)) continue
      cells++
      if (blocks.cls[c] !== CELL.building) ground++
      if (blocks.streetEdge[c]) {
        edge++
        if (blocks.cls[c] === CELL.building) edgeBuilt++
      }
      if (blocks.cls[c] === CELL.courtyard) courtyard++
      if (green.patchId[c] >= 0) greenCells++
    }
    const km2 = (cells * CELL_M * CELL_M) / 1e6
    const bs = buildings.map((b, i) => i).filter((i) => keep(...buildings[i].rings[0][0]))
    const facade = bs.reduce((f, i) => {
      for (const k in adjacency.facade[i]) f[k] = (f[k] ?? 0) + adjacency.facade[i][k]
      return f
    }, {})
    const facadeTotal = Object.values(facade).reduce((a, b) => a + b, 0) || 1
    result[where] = {
      integrationLocal: mean(segs.map((k) => syntax.radii.r800.integration[k])),
      integrationGlobal: mean(segs.map((k) => syntax.radii.n.integration[k])),
      choiceLocal: mean(segs.map((k) => syntax.radii.r800.choiceNorm[k])),
      junctionsPerKm2: nodes.filter((v) => syntax.degree[v] >= 3).length / km2,
      deadEnds: nodes.filter((v) => syntax.degree[v] === 1).length,
      hw: median(segs.map((k) => canyons[k].hw).filter((v) => v > 0)),
      enclosure: mean(segs.map((k) => canyons[k].enclosure)),
      partyWallShare: bs.filter((i) => adjacency.neighbours[i] > 0).length / (bs.length || 1),
      facadeStreet: facade.street / facadeTotal,
      facadeParty: facade.party / facadeTotal,
      facadeCourtyard: facade.courtyard / facadeTotal,
      continuity: edge ? edgeBuilt / edge : NaN,
      courtyardShare: courtyard / (ground || 1),
      greenShare: greenCells / (ground || 1),
      areaKm2: km2,
    }
  }
  return result
}
