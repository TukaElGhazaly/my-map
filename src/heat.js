// A model of surface heat on a hot summer day, on a grid of 4 m squares.
//
// Measured from the city kit: building footprints and heights, land use per plot, and the
// gaps between plots (street space). From these come the sky view factor and the shadows.
// Assumed: the weather, the materials and how much greenery each land use has.
// The city kit has no satellite temperatures, no trees and no materials: everything
// here is a model to compare places, not a measurement.

export const CELL_M = 4
const SIGMA = 5.67e-8 // Stefan-Boltzmann constant, W/(m²K⁴)
const RHO_CP = 1200 // heat capacity of air, J/(m³K)
const K0 = 273.15

// ---------- the day ----------

export const DAY = { label: '21 July, clear sky', month: 7, day: 21, lat: 50.9827, lon: 11.3248 }
export const TIMES = {
  t11: { label: '11:00', hour: 11, airC: 27 },
  t15: { label: '15:00', hour: 15, airC: 30 },
  t18: { label: '18:00', hour: 18, airC: 28 },
}
const SKY_EMISSIVITY = 0.8 // a clear, humid summer sky
const WALL_EXCESS_K = 6 // on a sunny afternoon, walls are on average this much warmer than the air
const WALL_ALBEDO = 0.3 // plastered and stone walls

// Where the sun is, for summer time (UTC+2) in Weimar.
export function sunAt(hour) {
  const rad = Math.PI / 180
  const n = Math.round(30.4 * (DAY.month - 1) + DAY.day)
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + n)) / 365)
  const B = (2 * Math.PI * (n - 81)) / 364
  const eqTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B) // minutes
  const solarTime = hour - 2 + DAY.lon / 15 + eqTime / 60
  const H = 15 * (solarTime - 12) * rad
  const phi = DAY.lat * rad
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H)
  const alt = Math.asin(sinAlt)
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI // from north
  // Clear-sky sunlight: direct (on a surface facing the sun) and diffuse (from the whole sky).
  const airMass = 1 / Math.max(sinAlt, 0.05)
  const direct = sinAlt > 0 ? 1353 * Math.pow(0.7, Math.pow(airMass, 0.678)) : 0
  const diffuse = sinAlt > 0 ? 0.14 * direct * sinAlt + 20 : 0
  return { alt, az, direct, diffuse, altDeg: alt / rad, azDeg: az / rad }
}

// ---------- the surfaces ----------

// albedo: share of sunlight reflected. emissivity: how well it radiates heat.
// evap: share of the available energy that goes into evaporation (latent heat).
// ground: share of net radiation stored in the ground. ra: how hard it is for heat to
// leave into the air (s/m, rough canopies give heat away easily).
export const MATERIALS = {
  asphalt: { label: 'asphalt', albedo: 0.1, emissivity: 0.95, evap: 0.0, ground: 0.35, ra: 80 },
  paving: { label: 'paving stone, concrete', albedo: 0.3, emissivity: 0.92, evap: 0.03, ground: 0.3, ra: 80 },
  roof: { label: 'roof', albedo: 0.15, emissivity: 0.9, evap: 0.0, ground: 0.15, ra: 60 },
  soil: { label: 'bare, unpaved soil', albedo: 0.2, emissivity: 0.94, evap: 0.2, ground: 0.2, ra: 70 },
  grass: { label: 'grass', albedo: 0.22, emissivity: 0.97, evap: 0.55, ground: 0.1, ra: 60 },
  trees: { label: 'tree canopy', albedo: 0.16, emissivity: 0.97, evap: 0.7, ground: 0.05, ra: 25 },
  water: { label: 'water', albedo: 0.07, emissivity: 0.98, evap: 0.8, ground: 0.45, ra: 100 },
}
export const WATER_C = 24 // water surfaces stay near this temperature

// What the open (unbuilt) ground of each land use is assumed to be made of.
export const MIXES = {
  street: { label: 'Street space (between plots)', group: 'street', mix: { asphalt: 0.75, paving: 0.2, trees: 0.05 } },
  square: { label: 'Square', group: 'square', mix: { paving: 0.85, trees: 0.1, grass: 0.05 } },
  residential: { label: 'Residential yards', group: 'yard', mix: { paving: 0.35, grass: 0.35, trees: 0.2, soil: 0.1 } },
  'mixed use': { label: 'Mixed-use yards', group: 'yard', mix: { paving: 0.6, grass: 0.2, trees: 0.15, soil: 0.05 } },
  'special functions': { label: 'Institutions (campus, schools)', group: 'yard', mix: { paving: 0.5, grass: 0.25, trees: 0.2, soil: 0.05 } },
  'industrial and commercial': { label: 'Industrial, commercial', group: 'yard', mix: { asphalt: 0.5, paving: 0.25, grass: 0.15, trees: 0.05, soil: 0.05 } },
  recreation: { label: 'Parks', group: 'green', mix: { trees: 0.45, grass: 0.4, paving: 0.1, soil: 0.05 } },
  cemetery: { label: 'Cemetery', group: 'green', mix: { trees: 0.4, grass: 0.35, paving: 0.15, soil: 0.1 } },
  wasteland: { label: 'Wasteland', group: 'green', mix: { soil: 0.6, grass: 0.4 } },
  'flowing water': { label: 'River', group: 'water', mix: { water: 1 } },
  'standing water': { label: 'Pond', group: 'water', mix: { water: 1 } },
  roof: { label: 'Roofs', group: 'roof', mix: { roof: 1 } },
  unknown: { label: 'Outside the plots, no data', group: 'unknown', mix: { soil: 1 } },
}
const MIX_KEYS = Object.keys(MIXES)

// ---------- the grid ----------

function insideRings(rings, x, y) {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

// Paint polygons onto the grid: calls paint(cellIndex) for every cell whose centre lies inside.
function rasterize(grid, rings, bbox, paint) {
  const { nx, ny, x0, y0 } = grid
  const i0 = Math.max(0, Math.floor((bbox[0] - x0) / CELL_M)), i1 = Math.min(nx - 1, Math.floor((bbox[2] - x0) / CELL_M))
  const j0 = Math.max(0, Math.floor((bbox[1] - y0) / CELL_M)), j1 = Math.min(ny - 1, Math.floor((bbox[3] - y0) / CELL_M))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (insideRings(rings, x0 + (i + 0.5) * CELL_M, y0 + (j + 0.5) * CELL_M)) paint(j * nx + i)
}

export const STREET_REACH_M = 25 // ground outside the plots counts as street space this close to a path

export function buildGrid(size, buildings, plots, net) {
  const [w, h] = size
  const nx = Math.ceil(w / CELL_M), ny = Math.ceil(h / CELL_M)
  const grid = { nx, ny, x0: -w / 2, y0: -h / 2, n: nx * ny }
  grid.height = new Float32Array(grid.n) // building height on this cell, 0 for open ground
  // Ground outside every plot is street space near the network, and unknown further away.
  grid.cover = new Uint8Array(grid.n).fill(MIX_KEYS.indexOf('unknown'))
  const streetKey = MIX_KEYS.indexOf('street')
  for (const e of net.edges)
    for (let k = 1; k < e.pts.length; k++) {
      const [ax, ay] = e.pts[k - 1], [bx, by] = e.pts[k]
      const box = [Math.min(ax, bx) - STREET_REACH_M, Math.min(ay, by) - STREET_REACH_M, Math.max(ax, bx) + STREET_REACH_M, Math.max(ay, by) + STREET_REACH_M]
      const i0 = Math.max(0, Math.floor((box[0] - grid.x0) / CELL_M)), i1 = Math.min(nx - 1, Math.floor((box[2] - grid.x0) / CELL_M))
      const j0 = Math.max(0, Math.floor((box[1] - grid.y0) / CELL_M)), j1 = Math.min(ny - 1, Math.floor((box[3] - grid.y0) / CELL_M))
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          if (grid.cover[j * nx + i] === streetKey) continue
          const x = grid.x0 + (i + 0.5) * CELL_M, y = grid.y0 + (j + 0.5) * CELL_M
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
          const ex = x - ax - t * dx, ey = y - ay - t * dy
          if (ex * ex + ey * ey <= STREET_REACH_M * STREET_REACH_M) grid.cover[j * nx + i] = streetKey
        }
    }
  grid.building = new Int32Array(grid.n).fill(-1) // which building stands on this cell
  for (const p of plots) {
    const k = MIX_KEYS.indexOf(p.landuse)
    if (k >= 0) rasterize(grid, p.rings, p.bbox, (c) => (grid.cover[c] = k))
  }
  const roof = MIX_KEYS.indexOf('roof')
  buildings.forEach((b, bi) =>
    rasterize(grid, b.rings, b.bbox, (c) => {
      grid.cover[c] = roof
      if (b.height >= grid.height[c]) grid.building[c] = bi
      grid.height[c] = Math.max(grid.height[c], b.height)
    }),
  )

  // Surface properties: each cover's materials, mixed by their shares.
  const props = MIX_KEYS.map((key) => {
    const p = { albedo: 0, emissivity: 0, evap: 0, ground: 0, ra: 0, trees: 0, green: 0, sealed: 0, water: 0 }
    for (const [m, share] of Object.entries(MIXES[key].mix)) {
      for (const f of ['albedo', 'emissivity', 'evap', 'ground', 'ra']) p[f] += share * MATERIALS[m][f]
      if (m === 'trees') p.trees += share
      if (m === 'trees' || m === 'grass') p.green += share
      if (m === 'asphalt' || m === 'paving' || m === 'roof') p.sealed += share
      if (m === 'water') p.water += share
    }
    return p
  })
  grid.props = props
  grid.coverKeys = MIX_KEYS
  grid.svf = skyViewFactor(grid)
  grid.night = Float32Array.from(grid.svf, (svf, c) => (grid.height[c] > 0 ? 0 : Math.max(0, 15.27 - 13.88 * svf)))
  return grid
}

// Sky view factor: the share of the sky seen from the ground, between 0 (a deep shaft) and 1 (open field).
// In 16 directions, the steepest building edge within 100 m blocks the sky below it.
const SVF_DIRECTIONS = 16
const SVF_RADIUS_M = 100

function skyViewFactor(grid) {
  const { nx, ny, height } = grid
  const svf = new Float32Array(grid.n).fill(1)
  const dirs = Array.from({ length: SVF_DIRECTIONS }, (_, d) => {
    const a = (2 * Math.PI * d) / SVF_DIRECTIONS
    return [Math.cos(a), Math.sin(a)]
  })
  const steps = Math.floor(SVF_RADIUS_M / CELL_M)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i
      if (height[c] > 0) continue // roofs see the whole sky
      let blocked = 0
      for (const [dx, dy] of dirs) {
        let maxTan = 0
        for (let s = 1; s <= steps; s++) {
          const ii = Math.floor(i + 0.5 + dx * s), jj = Math.floor(j + 0.5 + dy * s)
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break
          const t = height[jj * nx + ii] / (s * CELL_M)
          if (t > maxTan) maxTan = t
        }
        blocked += (maxTan * maxTan) / (1 + maxTan * maxTan) // sin² of the horizon angle
      }
      svf[c] = 1 - blocked / SVF_DIRECTIONS
    }
  return svf
}

// Shadows of the buildings: 1 where the sun reaches the surface, 0 in shadow.
function sunlit(grid, sun) {
  const { nx, ny, height } = grid
  const lit = new Uint8Array(grid.n)
  if (sun.alt <= 0) return lit
  const tanAlt = Math.tan(sun.alt)
  const dx = Math.sin(sun.az), dy = Math.cos(sun.az) // towards the sun: x east, y north
  const maxSteps = Math.ceil(40 / tanAlt / CELL_M) // no building is taller than 40 m
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i
      const base = height[c]
      let shaded = false
      for (let s = 1; s <= maxSteps && !shaded; s++) {
        const ii = Math.floor(i + 0.5 + dx * s), jj = Math.floor(j + 0.5 + dy * s)
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break
        if (height[jj * nx + ii] > base + s * CELL_M * tanAlt) shaded = true
      }
      lit[c] = shaded ? 0 : 1
    }
  return lit
}

// ---------- the energy balance of every surface ----------
//   absorbed sun + longwave from sky and walls − longwave emitted
//     = sensible heat (warms the air) + latent heat (evaporation) + heat into the ground

export function heatAt(grid, timeKey) {
  const time = TIMES[timeKey]
  const sun = sunAt(time.hour)
  const lit = sunlit(grid, sun)
  const Ta = time.airC + K0
  const Lsky = SKY_EMISSIVITY * SIGMA * Ta ** 4
  const Lwall = SIGMA * (Ta + WALL_EXCESS_K) ** 4 // emitted plus reflected by the walls
  const Lleaf = 0.97 * SIGMA * Ta ** 4
  const sinAlt = Math.max(0, Math.sin(sun.alt))
  // How much of a standing person faces the direct sun.
  const h = sun.altDeg
  const personFacing = h > 0 ? 0.308 * Math.cos(((h * (1 - (h * h) / 48402)) * Math.PI) / 180) : 0

  const n = grid.n
  const out = {
    sun, time, lit,
    ts: new Float32Array(n), sensible: new Float32Array(n), latent: new Float32Array(n),
    storage: new Float32Array(n), netRad: new Float32Array(n), tmrt: new Float32Array(n),
  }
  for (let c = 0; c < n; c++) {
    const p = grid.props[grid.cover[c]]
    const svf = grid.svf[c]
    const s = lit[c]
    // Sun on the surface: direct where lit (tree canopy itself is lit), diffuse from the visible sky.
    const K = s * sun.direct * sinAlt + sun.diffuse * svf
    const Ldown = svf * Lsky + (1 - svf) * Lwall
    const absorbed = (1 - p.albedo) * K + p.emissivity * Ldown
    let T
    if (p.water > 0.5) T = WATER_C + K0
    else {
      // Solve: share of net radiation left for the air = sensible heat flux.
      const A = (1 - p.evap) * (1 - p.ground)
      const ra = p.ra + 40 * (1 - svf) // canyons are less ventilated
      T = Ta + 10
      for (let it = 0; it < 8; it++) {
        const Rn = absorbed - p.emissivity * SIGMA * T ** 4
        const f = A * Rn - (RHO_CP * (T - Ta)) / ra
        const df = -4 * A * p.emissivity * SIGMA * T ** 3 - RHO_CP / ra
        T -= f / df
      }
    }
    const Rn = absorbed - p.emissivity * SIGMA * T ** 4
    const ra = p.ra + 40 * (1 - svf)
    const Hs = (RHO_CP * (T - Ta)) / ra
    let LE, G
    if (p.water > 0.5) {
      LE = Math.max(0, 0.5 * Rn)
      G = Rn - LE - Hs
    } else {
      G = p.ground * Rn
      LE = p.evap * (Rn - G)
    }
    out.ts[c] = T - K0
    out.netRad[c] = Rn
    out.sensible[c] = Hs
    out.latent[c] = LE
    out.storage[c] = G

    // Mean radiant temperature of a person standing here (not on roofs).
    if (grid.height[c] > 0) {
      out.tmrt[c] = NaN
      continue
    }
    const canopy = 0.8 * p.trees // tree crowns hide this share of the sky and the sun
    const personLit = s * (1 - canopy)
    const skySeen = svf * (1 - canopy)
    const groundSun = s * sun.direct * sinAlt * (1 - canopy) + sun.diffuse * svf
    // Sunlight bounced off the walls around: about half the walls are in the sun.
    const wallSun = (1 - svf) * WALL_ALBEDO * 0.5 * sun.direct * Math.cos(sun.alt)
    const shortwave =
      0.7 * (personLit * personFacing * sun.direct + 0.5 * sun.diffuse * skySeen + 0.5 * p.albedo * groundSun + 0.5 * wallSun)
    const fromAbove = skySeen * Lsky + svf * canopy * Lleaf + (1 - svf) * Lwall
    const fromBelow = p.emissivity * SIGMA * T ** 4 + (1 - p.emissivity) * Ldown
    const absorbedByPerson = shortwave + 0.97 * (0.5 * fromAbove + 0.5 * fromBelow)
    out.tmrt[c] = Math.pow(absorbedByPerson / (0.97 * SIGMA), 0.25) - K0
  }
  out.limits = thresholds(grid, out)
  return out
}

// ---------- reading the results ----------

// Hotspots: the hottest tenth of public space. Cooling buffers: green places
// (at least half trees or grass) at least 10 K cooler than open, sunlit street.
export const HOTSPOT_SHARE = 0.1
export const BUFFER_DROP_K = 10
export const BUFFER_GREEN = 0.5

// Public space a person can stand in: streets, squares, parks.
export const isPublic = (grid, c) =>
  grid.height[c] === 0 && ['street', 'square', 'green'].includes(MIXES[grid.coverKeys[grid.cover[c]]].group)

function thresholds(grid, heat) {
  const values = []
  const street = grid.coverKeys.indexOf('street')
  let sunnyStreet = 0, sunnyCells = 0
  for (let c = 0; c < grid.n; c++) {
    if (!isPublic(grid, c)) continue
    values.push(heat.tmrt[c])
    if (grid.cover[c] === street && heat.lit[c]) {
      sunnyStreet += heat.tmrt[c]
      sunnyCells++
    }
  }
  values.sort((m, n) => m - n)
  const sunnyStreetTmrt = sunnyStreet / sunnyCells
  return {
    hot: values[Math.floor(values.length * (1 - HOTSPOT_SHARE))],
    sunnyStreet: sunnyStreetTmrt,
    cool: sunnyStreetTmrt - BUFFER_DROP_K,
    publicCells: values.length,
  }
}

export function classify(grid, heat, c) {
  if (!isPublic(grid, c)) return null
  if (heat.tmrt[c] >= heat.limits.hot) return 'hotspot'
  if (grid.props[grid.cover[c]].green >= BUFFER_GREEN && heat.tmrt[c] <= heat.limits.cool) return 'buffer'
  return null
}

// Averages for each kind of surface.
export function summary(grid, heat) {
  const rows = MIX_KEYS.map((key) => ({ key, label: MIXES[key].label, cells: 0, ts: 0, sensible: 0, latent: 0, tmrt: 0, svf: 0 }))
  let hotspots = 0, buffers = 0
  for (let c = 0; c < grid.n; c++) {
    const r = rows[grid.cover[c]]
    r.cells++
    r.ts += heat.ts[c]
    r.sensible += heat.sensible[c]
    r.latent += heat.latent[c]
    r.svf += grid.svf[c]
    if (!Number.isNaN(heat.tmrt[c])) r.tmrt += heat.tmrt[c]
    const k = classify(grid, heat, c)
    if (k === 'hotspot') hotspots++
    if (k === 'buffer') buffers++
  }
  for (const r of rows) for (const f of ['ts', 'sensible', 'latent', 'tmrt', 'svf']) r[f] /= r.cells || 1
  const area = (cells) => cells * CELL_M * CELL_M
  return {
    rows: rows.filter((r) => r.cells > 0 && MIXES[r.key].group !== 'unknown'),
    hotspotShare: hotspots / heat.limits.publicCells,
    hotspotArea: area(hotspots),
    bufferArea: area(buffers),
  }
}

export function cellAt(grid, x, y) {
  const i = Math.floor((x - grid.x0) / CELL_M), j = Math.floor((y - grid.y0) / CELL_M)
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return -1
  return j * grid.nx + i
}

// Values every 4 m along a straight line between two points.
export function transect(grid, heat, [ax, ay], [bx, by]) {
  const length = Math.hypot(bx - ax, by - ay)
  const n = Math.floor(length / CELL_M)
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n
    const c = cellAt(grid, ax + (bx - ax) * t, ay + (by - ay) * t)
    return {
      d: t * length,
      ts: heat.ts[c],
      tmrt: heat.tmrt[c],
      svf: grid.svf[c],
      green: grid.props[grid.cover[c]].green,
      roof: grid.height[c] > 0,
    }
  })
}

// The average roof surface temperature of every building (NaN for buildings too small for a cell).
export function roofTemperatures(grid, heat, count) {
  const sum = new Float64Array(count), cells = new Uint32Array(count)
  for (let c = 0; c < grid.n; c++) {
    const b = grid.building[c]
    if (b < 0) continue
    sum[b] += heat.ts[c]
    cells[b]++
  }
  return Array.from(sum, (v, b) => (cells[b] ? v / cells[b] : NaN))
}
