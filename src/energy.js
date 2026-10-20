// The heat balance of every building, from its measured shape and a few assumed values.
//
// Thermodynamics in two sentences:
// - Heat flows from warm to cold. Through a surface it flows at U × area × temperature difference,
//   so a wall shared with a heated neighbour (no temperature difference) loses almost nothing.
// - Energy is conserved: over the heating season, heat in (heating, people and appliances,
//   sun through windows) equals heat out (walls, windows, roof, ground floor, ventilation).

// ---------- assumed values: none of these are in the city kit ----------

export const MIN_HEATED_HEIGHT_M = 3 // lower buildings are taken as sheds, garages and carports
export const WINDOW_SHARE = 0.3 // share of each outside wall that is window
const SHARED_TOLERANCE_M = 0.5 // two walls closer than this count as one shared wall

// Heating-period degree-hours for a German reference climate (DIN V 4108-6, heating-period method):
// one W/K of heat loss costs 66 kWh over the heating season.
export const KWH_PER_W_PER_K = 66
export const GROUND_FACTOR = 0.6 // the ground under a building is warmer than the outside air
export const AIR_CHANGES_PER_H = 0.6 // fresh air: 0.6 times the air volume per hour
export const AIR_VOLUME_SHARE = 0.8 // share of the gross volume that is air in heated rooms
const AIR_HEAT_WH_PER_M3K = 0.34 // heat capacity of air
export const INTERNAL_GAINS_KWH_M2 = 22 // people and appliances, per m² floor area and season
export const WINDOW_G = 0.6 // share of sunlight that passes through the glass
const FRAME_AND_SHADE = 0.7 * 0.9 // frames and shading block part of the sun
export const GAIN_USE = 0.95 // share of the gains that actually replaces heating

// Sun on a wall over the heating season, by the direction it faces (kWh per m²):
// south 270, east and west about 185, north 100.
const sunOnWall = (facingFromSouthRad) => 185 + 85 * Math.cos(facingFromSouthRad)

// U-values in W/(m²·K): how much heat passes through one m² for each degree of difference.
export const STANDARDS = {
  unrenovated: { label: 'Unrenovated', wall: 1.4, window: 2.8, roof: 1.0, ground: 1.0 },
  renovated: { label: 'Partly renovated', wall: 0.8, window: 1.6, roof: 0.4, ground: 0.8 },
  new: { label: 'New build (GEG)', wall: 0.28, window: 1.3, roof: 0.2, ground: 0.35 },
}

// ---------- the shape: measured from footprints and heights ----------

function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return a / 2
}

const GRID_M = 20

// For every building: outside wall area, wall area shared with heated neighbours,
// roof, ground floor, volume, and the sun on its outside walls.
export function measureEnvelopes(buildings) {
  const heated = buildings.map((b) => b.height >= MIN_HEATED_HEIGHT_M && b.floorArea > 0)

  // All wall edges of heated buildings in a grid, to find neighbours quickly.
  const grid = new Map()
  buildings.forEach((b, i) => {
    if (!heated[i]) return
    for (const ring of b.rings)
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length]
        const edge = { i, p, q }
        const x0 = Math.floor((Math.min(p[0], q[0]) - SHARED_TOLERANCE_M) / GRID_M)
        const x1 = Math.floor((Math.max(p[0], q[0]) + SHARED_TOLERANCE_M) / GRID_M)
        const y0 = Math.floor((Math.min(p[1], q[1]) - SHARED_TOLERANCE_M) / GRID_M)
        const y1 = Math.floor((Math.max(p[1], q[1]) + SHARED_TOLERANCE_M) / GRID_M)
        for (let gx = x0; gx <= x1; gx++)
          for (let gy = y0; gy <= y1; gy++) {
            const key = gx + ',' + gy
            if (!grid.has(key)) grid.set(key, [])
            grid.get(key).push(edge)
          }
      }
  })

  return buildings.map((b, i) => {
    const footprint = Math.abs(ringArea(b.rings[0])) - b.rings.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0)
    const env = {
      heated: heated[i],
      footprint,
      volume: footprint * b.height,
      roof: footprint, // flat-roof simplification: the kit has heights, not roof shapes
      ground: footprint,
      wallOutside: 0,
      wallShared: 0,
      sunOnWalls: 0, // kWh per season reaching the outside walls, before windows
    }
    if (!heated[i]) return env

    b.rings.forEach((ring, r) => {
      // The side of each edge that faces away from the building.
      const ccw = ringArea(ring) > 0
      const outwardRight = r === 0 ? ccw : !ccw
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length]
        const dx = q[0] - p[0], dy = q[1] - p[1]
        const len = Math.hypot(dx, dy)
        if (len < 0.01) continue
        const ux = dx / len, uy = dy / len

        // Parts of this edge that touch a heated neighbour's wall, and that neighbour's height.
        const touching = []
        const seen = new Set()
        const gx0 = Math.floor((Math.min(p[0], q[0]) - SHARED_TOLERANCE_M) / GRID_M)
        const gx1 = Math.floor((Math.max(p[0], q[0]) + SHARED_TOLERANCE_M) / GRID_M)
        const gy0 = Math.floor((Math.min(p[1], q[1]) - SHARED_TOLERANCE_M) / GRID_M)
        const gy1 = Math.floor((Math.max(p[1], q[1]) + SHARED_TOLERANCE_M) / GRID_M)
        for (let gx = gx0; gx <= gx1; gx++)
          for (let gy = gy0; gy <= gy1; gy++)
            for (const f of grid.get(gx + ',' + gy) ?? []) {
              if (f.i === i || seen.has(f)) continue
              seen.add(f)
              const fx = f.q[0] - f.p[0], fy = f.q[1] - f.p[1]
              const flen = Math.hypot(fx, fy)
              if (flen < 0.01 || Math.abs(ux * fy - uy * fx) / flen > 0.1) continue // not parallel
              const off = (pt) => Math.abs((pt[0] - p[0]) * uy - (pt[1] - p[1]) * ux)
              if (off(f.p) > SHARED_TOLERANCE_M || off(f.q) > SHARED_TOLERANCE_M) continue // not in line
              const t1 = (f.p[0] - p[0]) * ux + (f.p[1] - p[1]) * uy
              const t2 = (f.q[0] - p[0]) * ux + (f.q[1] - p[1]) * uy
              const a = Math.max(0, Math.min(t1, t2)), c = Math.min(len, Math.max(t1, t2))
              if (c - a > 0.1) touching.push([a, c, buildings[f.i].height])
            }

        // Along the edge: wall above the tallest touching neighbour is outside wall.
        const cuts = [0, len, ...touching.flatMap(([a, c]) => [a, c])].sort((m, n) => m - n)
        let outside = 0
        for (let s = 1; s < cuts.length; s++) {
          const a = cuts[s - 1], c = cuts[s]
          if (c - a <= 0) continue
          const mid = (a + c) / 2
          let neighbour = 0
          for (const [ta, tc, h] of touching) if (ta <= mid && mid <= tc) neighbour = Math.max(neighbour, h)
          outside += (c - a) * (b.height - Math.min(b.height, neighbour))
        }
        env.wallOutside += outside
        env.wallShared += len * b.height - outside

        // Which way the outside of this wall faces, measured from south
        // (the north part of the outward direction; the outward direction is (uy, -ux) on the right).
        const north = outwardRight ? -ux : ux
        env.sunOnWalls += outside * sunOnWall(Math.acos(Math.max(-1, Math.min(1, -north))))
      }
    })
    env.envelope = env.wallOutside + env.roof + env.ground
    env.compactness = env.envelope / env.volume // A/V in 1/m: lower is more compact
    env.sharedShare = env.wallShared / (env.wallShared + env.wallOutside || 1)
    return env
  })
}

// ---------- the heat balance over one heating season, in kWh ----------

export function heatBalance(building, env, standard) {
  if (!env.heated) return null
  const U = STANDARDS[standard]
  const windows = env.wallOutside * WINDOW_SHARE
  const walls = env.wallOutside - windows
  const k = KWH_PER_W_PER_K
  const out = {
    walls: k * U.wall * walls,
    windows: k * U.window * windows,
    roof: k * U.roof * env.roof,
    ground: k * U.ground * GROUND_FACTOR * env.ground,
    ventilation: k * AIR_HEAT_WH_PER_M3K * AIR_CHANGES_PER_H * AIR_VOLUME_SHARE * env.volume,
  }
  const losses = out.walls + out.windows + out.roof + out.ground + out.ventilation
  const gains = {
    internal: INTERNAL_GAINS_KWH_M2 * building.floorArea,
    sun: env.sunOnWalls * WINDOW_SHARE * WINDOW_G * FRAME_AND_SHADE,
  }
  const allGains = gains.internal + gains.sun
  const heating = Math.max(0, losses - GAIN_USE * allGains)
  // Gains that don't replace heating leave the building too (open windows, overheating).
  out.unusedGains = heating + allGains - losses
  return { in: { heating, ...gains }, out, losses, heating, perM2: heating / building.floorArea }
}

// The balances of many buildings added up.
export function sumBalances(balances) {
  const total = { in: { heating: 0, internal: 0, sun: 0 }, out: { walls: 0, windows: 0, roof: 0, ground: 0, ventilation: 0, unusedGains: 0 }, losses: 0, heating: 0 }
  for (const b of balances) {
    if (!b) continue
    for (const key in total.in) total.in[key] += b.in[key]
    for (const key in total.out) total.out[key] += b.out[key]
    total.losses += b.losses
    total.heating += b.heating
  }
  return total
}

// ---------- energy certificate classes (Energieausweis, kWh per m² and year) ----------

export const CLASSES = [
  { label: 'A+', max: 30, color: '#3f8f5a' },
  { label: 'A', max: 50, color: '#6aa65a' },
  { label: 'B', max: 75, color: '#9bbd5e' },
  { label: 'C', max: 100, color: '#c8cf68' },
  { label: 'D', max: 130, color: '#e3cf6a' },
  { label: 'E', max: 160, color: '#e6b25f' },
  { label: 'F', max: 200, color: '#de8d55' },
  { label: 'G', max: 250, color: '#cf6649' },
  { label: 'H', max: Infinity, color: '#b0413e' },
]

export const classOf = (perM2) => CLASSES.find((c) => perM2 < c.max)
