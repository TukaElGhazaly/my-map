// The renovation fund of the city of Weimar: money for five renovations in the whole area.
// The app works out the facts (heat saved, residents, public use); a language model on my laptop
// decides, through the small endpoint in fund-server.js that only exists in the Vite dev server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { heatBalance } from './energy.js'

export const BUDGET = 5
export const THINK_EVERY_MS = 60 * 1000
const CANDIDATES = 10
export const PUBLIC_USES = new Set(['education', 'civic', 'culture', 'health', 'sport'])
const ENDPOINT = `${import.meta.env.BASE_URL}api/fund`

// Residents per building, estimated: each census cell's population shared among the residential
// floor area of the buildings whose centre lies in it. null where the cell has no figure.
export function estimateResidents(buildings, cells) {
  const centre = (b) => {
    const r = b.rings[0]
    return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]
  }
  const inside = (ring, [x, y]) => {
    let inn = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn
    }
    return inn
  }
  const cellOf = buildings.map((b) => {
    const p = centre(b)
    return cells.findIndex((c) => p[0] >= c.bbox[0] && p[0] <= c.bbox[2] && p[1] >= c.bbox[1] && p[1] <= c.bbox[3] && inside(c.ring, p))
  })
  const homes = buildings.map((b) => b.homeArea ?? 0)
  const perCell = new Map()
  cellOf.forEach((c, i) => perCell.set(c, (perCell.get(c) ?? 0) + homes[i]))
  return buildings.map((b, i) => {
    const cell = cells[cellOf[i]]
    if (!cell || cell.population == null) return null
    const all = perCell.get(cellOf[i])
    return all > 0 ? (cell.population * homes[i]) / all : 0
  })
}

const round = (n, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits

// What the fund is told about one building. The saving is the heating at today's standard
// minus the heating at the new-build standard, over one heating season.
function facts(data, i, standard, residents) {
  const b = data.buildings[i], env = data.envelopes[i]
  const now = heatBalance(b, env, standard), after = heatBalance(b, env, 'new')
  return {
    id: b.id,
    use: b.use,
    public_use: PUBLIC_USES.has(b.use),
    floor_area_m2: Math.round(b.floorArea),
    residents_estimated: residents[i] == null ? null : Math.round(residents[i]),
    heat_demand_kwh_per_m2: Math.round(now.perM2),
    heating_now_kwh_per_season: Math.round(now.heating),
    compactness_av_per_m: round(env.compactness, 2),
    shared_wall_share: round(env.sharedShare, 2),
    saving_if_renovated_kwh_per_season: Math.round(now.heating - after.heating),
  }
}

// Everything the fund is sent when it thinks. `allowed` maps the ids it may renovate to building indices.
function situation(data, standard, residents, renovations, clicked) {
  const done = new Set(renovations.map((r) => r.index))
  const ranked = data.buildings
    .map((b, i) => i)
    .filter((i) => data.envelopes[i].heated && !done.has(i))
    .map((i) => [i, heatBalance(data.buildings[i], data.envelopes[i], standard).heating])
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATES)
    .map(([i]) => i)
  const allowed = new Map(ranked.map((i) => [data.buildings[i].id, i]))

  let clickedFacts = null
  if (clicked != null) {
    const b = data.buildings[clicked]
    if (!data.envelopes[clicked].heated) clickedFacts = { id: b.id, use: b.use, heated: false }
    else if (done.has(clicked))
      clickedFacts = { id: b.id, use: b.use, already_renovated: true, reason: renovations.find((r) => r.index === clicked).reason }
    else {
      clickedFacts = facts(data, clicked, standard, residents)
      allowed.set(b.id, clicked)
    }
  }

  return {
    allowed,
    payload: {
      clicked: clickedFacts,
      candidates: ranked.map((i) => facts(data, i, standard, residents)),
      remaining_budget: BUDGET - renovations.length,
      past_renovations: renovations.map((r) => ({ id: r.id, use: r.use, saving_kwh_per_season: r.saved, reason: r.reason })),
      insulation_today: standard,
    },
  }
}

// The fund's memory and its thinking. `active`: the Energy view is open.
export function useFund(data, standard, active) {
  const [renovations, setRenovations] = useState([]) // [{ index, id, use, saved, reason, label }]
  const [log, setLog] = useState([]) // newest first
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(!import.meta.env.DEV)
  const residents = useMemo(() => data && estimateResidents(data.buildings, data.cells), [data])
  const state = useRef()
  state.current = { data, standard, offline, residents }
  const done = useRef([]) // the renovations, updated at once, so a quick second call already sees them
  const thinking = useRef(false)
  const nextClick = useRef(null) // a click that came in while the fund was thinking

  const left = BUDGET - renovations.length

  const think = useCallback(
    async (clicked) => {
      const { data, standard, offline, residents } = state.current
      const renovations = done.current
      if (!data || offline || renovations.length >= BUDGET) return
      if (thinking.current) {
        if (clicked != null) nextClick.current = clicked
        return
      }
      thinking.current = true
      setBusy(true)
      const { allowed, payload } = situation(data, standard, residents, renovations, clicked)
      const entry = { time: new Date(), trigger: clicked != null ? `click on building ${data.buildings[clicked].id}` : 'its own minute' }
      try {
        const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (r.status === 404) {
          setOffline(true)
          return
        }
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || r.statusText)
        Object.assign(entry, { noticed: d.noticed, action: d.action, id: d.building_id, reason: d.reason })
        // The endpoint already rejects ids that weren't sent; check again here, against the list itself.
        if (d.action === 'renovate') {
          const index = allowed.get(d.building_id)
          if (index == null) {
            entry.action = 'rejected'
            entry.reason = `It asked to renovate ${d.building_id}, which wasn't on its list. ${d.reason}`
          } else {
            const b = data.buildings[index]
            const f = facts(data, index, standard, residents)
            entry.saved = f.saving_if_renovated_kwh_per_season
            if (done.current.length < BUDGET && !done.current.some((x) => x.index === index)) {
              done.current = [...done.current, { index, id: b.id, use: b.use, saved: entry.saved, reason: d.reason, label: d.label }]
              setRenovations(done.current)
            }
          }
        }
      } catch (e) {
        entry.action = 'error'
        entry.reason = e.message
      } finally {
        thinking.current = false
        setBusy(false)
      }
      setLog((l) => [entry, ...l])
      if (nextClick.current != null) {
        const c = nextClick.current
        nextClick.current = null
        setTimeout(() => think(c), 0)
      }
    },
    [],
  )

  // Once a minute by itself, while the Energy view is open and money is left.
  useEffect(() => {
    if (!active || offline || left <= 0) return
    const t = setInterval(() => think(null), THINK_EVERY_MS)
    return () => clearInterval(t)
  }, [active, offline, left, think])

  return { renovations, log, busy, offline, left, think }
}
