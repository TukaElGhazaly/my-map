// The thinking roof: the two roofs of my design, in sections, with plants, terraces and paths.
// The app works out the clock, the weather and the heat flows; the roof itself (a language model on my
// laptop, through the endpoint in roof-server.js) notices, speaks and decides.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const MONTH_MS = 60 * 1000 // one real minute is one month
export const DAY_MS = 24 * 1000 // a day and a night pass in 24 seconds
const SIM_HOURS_PER_MS = (30 * 24) / MONTH_MS // energy is counted at the month's pace: 12 hours per real second
export const THINK_EVERY_MS = 60 * 1000
const COMMENT_AFTER_MS = 2500 // wait for a few clicks before the roof comments on them
export const LIMIT_KW = 6.5 // above this heat flow through both roofs, the roof acts by itself
const LIMIT_PAUSE_MS = 45 * 1000
export const PASSIVE_SHARE = 0.6 // green share of the roof before it may switch the building to passive mode
const MAX_GROW = 3
const MAX_LOCK = 2
const ENDPOINT = `${import.meta.env.BASE_URL}api/roof`

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']
export const COVER = ['bare', 'thin', 'dense']

// Weimar's climate, rounded: mean air temperature per month, half the day-night swing, sunshine on a flat
// roof at noon on an average day, and the length of the day.
const T_MEAN = [-0.3, 0.6, 4.0, 8.6, 12.9, 16.1, 18.2, 17.8, 13.7, 9.0, 4.1, 0.9]
const T_SWING = [2.5, 3, 4, 5, 5.5, 5.5, 5.5, 5.5, 5, 4, 2.5, 2]
const SUN_PEAK = [180, 300, 450, 600, 720, 770, 760, 680, 530, 360, 210, 150]
const DAY_LENGTH = [8.4, 9.9, 11.8, 13.7, 15.3, 16.2, 15.8, 14.4, 12.5, 10.6, 8.9, 8.0]

// The roof's physics.
export const T_IN = 20 // °C inside, heated
export const T_COMFORT = 25 // °C: above this the top floor overheats
export const HEATING_BELOW = 12 // °C monthly mean: below it the heating runs (October to April)
export const U_ROOF = 0.25 // W/m²K: the insulated roof without plants
export const R_PLANTS = [0, 0.4, 1.2] // m²K/W the planting layer adds: bare, thin, dense
export const ABSORB = [0.85, 0.35, 0.15] // share of the sunshine that heats the surface: plants shade it and evaporate water
export const SKY = [4, 2, 0.5] // K a surface cools below the air on a clear night; plants hold it back
export const H_OUT = 20 // W/m²K from surface to air
export const WALLS_UA_PER_M = 1.6 // W/K per metre of facade of the top floor: walls and windows, 3 m high
export const GAINS_W_M2 = 4 // people and appliances on the top floor

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0)

export function clockAt(ms, startMonth, startHour) {
  const monthIndex = Math.floor(ms / MONTH_MS) + startMonth
  const month = ((monthIndex % 12) + 12) % 12
  const hour = (startHour + ((ms % DAY_MS) / DAY_MS) * 24) % 24
  const dl = DAY_LENGTH[month]
  const rise = 13 - dl / 2
  const sun = hour > rise && hour < rise + dl ? SUN_PEAK[month] * Math.sin((Math.PI * (hour - rise)) / dl) : 0
  return {
    monthIndex,
    month,
    hour,
    season: SEASONS[month],
    outdoor: T_MEAN[month] + T_SWING[month] * Math.cos((2 * Math.PI * (hour - 15)) / 24),
    sun,
    mode: T_MEAN[month] < HEATING_BELOW ? 'heating' : 'cooling',
  }
}

export const exposure = (s) => 1 + (s.facing === 'north' ? 0.25 : 0) + (s.corner ? 0.2 : 0) - (s.facing === 'south' ? 0.1 : 0)
export const cover = (st) => (st.use === 'free' ? st.cover : 0) // terraces and paths carry no plants

// Heat flow through one section in W. Positive is the bad direction: heat leaving the flats in the heating
// season, heat getting into them when it's warm.
export function flow(s, c, clock) {
  const u = exposure(s) / (1 / U_ROOF + R_PLANTS[c])
  const surface = clock.outdoor + (ABSORB[c] * clock.sun) / H_OUT - (clock.sun > 0 ? 0 : SKY[c])
  return clock.mode === 'heating' ? u * s.area * (T_IN - surface) : Math.max(0, u * s.area * (surface - T_COMFORT))
}

// Everything the scene, the panel and the roof need at this moment.
export function measure(roof, state, clock, passive) {
  const sections = roof.sections.map((s) => {
    const st = state[s.id]
    const now = flow(s, cover(st), clock)
    const bare = flow(s, 0, clock)
    return { ...s, ...st, flow: now, bare, saving: bare - now }
  })
  const buildings = roof.buildings.map((b, k) => {
    const mine = sections.filter((s) => s.building === k)
    const roofFlow = sum(mine, (s) => s.flow)
    const area = sum(mine, (s) => s.area)
    const green = sum(mine, (s) => (cover(s) === 2 ? 1 : cover(s) === 1 ? 0.5 : 0) * s.area) / area
    const facade = b.perimeter * WALLS_UA_PER_M
    let load
    if (clock.mode === 'heating') load = Math.max(0, roofFlow + facade * (T_IN - clock.outdoor) - GAINS_W_M2 * area)
    else load = roofFlow + Math.max(0, facade * (clock.outdoor - T_COMFORT))
    return { name: b.name, storeys: b.storeys, roofFlow, load, green, heatingOff: passive && clock.mode === 'heating' }
  })
  const area = sum(sections, (s) => s.area)
  return {
    sections,
    buildings,
    roofFlow: sum(sections, (s) => s.flow),
    roofBare: sum(sections, (s) => s.bare),
    green: sum(sections, (s) => (cover(s) === 2 ? 1 : cover(s) === 1 ? 0.5 : 0) * s.area) / area,
  }
}

// The heat flow through both roofs, averaged over a whole day of this month: a change's effect
// shouldn't depend on whether it happens at noon or at night.
export function dayMean(roof, state, clock) {
  let total = 0
  for (let h = 0; h < 24; h++) {
    const c = clockAt(((h + 24 - 18) % 24 / 24) * DAY_MS, clock.month, 18)
    total += measure(roof, state, c, false).roofFlow
  }
  return total / 24
}

export async function loadRoof() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/roof.json`)
  if (!r.ok) throw new Error(`data/roof.json: ${r.status}`)
  const roof = await r.json()
  const length = (ring) => ring.reduce((s, p, i) => s + Math.hypot(...ring[(i + 1) % ring.length].map((v, j) => v - p[j])), 0)
  for (const b of roof.buildings) b.perimeter = length(b.outline) + length(b.courtyard)
  for (const s of roof.sections) {
    s.centre = s.polygon.reduce(([x, y], p) => [x + p[0] / s.polygon.length, y + p[1] / s.polygon.length], [0, 0])
    s.z = roof.buildings[s.building].roof_z
  }
  return roof
}

// How the roof starts: thin planting all round, the south-facing sections are terraces with benches.
function initialState(roof) {
  return Object.fromEntries(roof.sections.map((s) => [s.id, { cover: 1, use: s.facing === 'south' ? 'terrace' : 'free', locked: false }]))
}

// What a click or a drawing does to one section. null: no change.
function target(st, kind) {
  if (kind === 'plant') return st.use === 'free' ? (st.cover < 2 ? { ...st, cover: st.cover + 1 } : null) : { ...st, use: 'free', cover: 1 }
  if (kind === 'area') return st.use === 'free' && st.cover === 2 ? null : { ...st, use: 'free', cover: 2 }
  if (kind === 'remove') return st.use === 'free' && st.cover > 0 ? { ...st, cover: 0 } : null
  if (kind === 'terrace') return st.use === 'terrace' ? null : { ...st, use: 'terrace', cover: 0 }
  if (kind === 'path') return st.use === 'path' ? null : { ...st, use: 'path', cover: 0 }
  if (kind === 'clear') return st.use === 'free' ? null : { ...st, use: 'free', cover: 0 }
  return null
}

// The sections a drawn area covers: those whose centre lies inside it.
export function sectionsInArea(roof, points) {
  const ring = points.map((p) => [p[0], p[1]])
  return roof.sections.filter((s) => insideRing(ring, s.centre)).map((s) => s.id)
}

// The sections a drawn path crosses: a band of 1 m on each side of the line touches them.
export function sectionsOnPath(roof, points, half = 1) {
  const near = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
  }
  return roof.sections
    .filter((s) =>
      points.slice(1).some((b, i) => {
        const a = points[i]
        if (insideRing(s.polygon, a) || insideRing(s.polygon, b)) return true
        return s.polygon.some((q) => near(q, a, b) < half) || near(s.centre, a, b) < half * 2
      }),
    )
    .map((s) => s.id)
}

function insideRing(ring, [x, y]) {
  let a = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) a = !a
  }
  return a
}

const losesPlants = (before, after) => cover(after) < cover(before)
const exposed = (s) => s.facing === 'north' || s.corner
const describe = (st) => (st.use === 'free' ? `${COVER[st.cover]} plants` : st.use)

// The facts the roof is sent about one section.
function sectionFacts(s, m) {
  return {
    id: s.id,
    building: s.building === 0 ? 'west' : 'east',
    facing: s.facing,
    corner: s.corner,
    exposure: Math.round(exposure(s) * 100) / 100,
    plants: COVER[cover(s)],
    use: s.use,
    locked: s.locked,
    heat_flow_w: Math.round(m.flow),
    saving_vs_bare_w: Math.round(m.saving),
  }
}

// The roof's memory and its thinking. `active`: the Roof view is open.
export function useRoof(roof, active) {
  const [state, setState] = useState(null)
  useEffect(() => {
    if (roof && !state) setState(initialState(roof))
  }, [roof, state])
  const [passive, setPassive] = useState(false)
  const [ms, setMs] = useState(0)
  const [paused, setPaused] = useState(false)
  const [log, setLog] = useState([]) // newest first
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(!import.meta.env.DEV)
  const [saved, setSaved] = useState(0) // kWh since the app opened, against a bare roof
  const [notice, setNotice] = useState(null) // a short message for something the app itself refused
  const start = useMemo(() => {
    const d = new Date()
    return { month: d.getMonth(), hour: 18 }
  }, [])
  const clock = useMemo(() => clockAt(ms, start.month, start.hour), [ms, start])
  const now = useMemo(() => roof && state && measure(roof, state, clock, passive), [roof, state, clock, passive])

  // Everything the thinking reads, always current.
  const live = useRef()
  live.current = { state, passive, clock, now, saved, offline }
  const memory = useRef({ lastChange: Date.now(), last: null, changes: [], queue: [], thinking: false, limitAt: 0 })

  // The clock, four times a second, while the view is open and not paused.
  useEffect(() => {
    if (!active || paused) return
    let prev = performance.now()
    const t = setInterval(() => {
      const t1 = performance.now()
      const dt = t1 - prev
      prev = t1
      setMs((v) => v + dt)
      const { now } = live.current
      if (!now) return
      const good =now.sections.reduce((s, x) => s + Math.max(0, x.bare) - Math.max(0, x.flow), 0)
      setSaved((v) => v + (good * SIM_HOURS_PER_MS * dt) / 1000)
    }, 250)
    return () => clearInterval(t)
  }, [active, paused])

  const situation = useCallback(
    (trigger, request) => {
      const { state, passive, clock, now, saved } = live.current
      const mem = memory.current
      const free = now.sections.filter((s) => s.use === 'free' && !s.locked)
      const actions = request ? ['allow', 'refuse'] : ['none', 'grow', 'lock']
      if (!request && !passive && now.green >= PASSIVE_SHARE) actions.push('passive')
      return {
        allowed: { actions, sections: request ? [] : free.map((s) => s.id) },
        payload: {
          trigger,
          request: request ?? null,
          clock: {
            month: MONTHS[clock.month],
            season: clock.season,
            time: `${String(Math.floor(clock.hour)).padStart(2, '0')}:00`,
            outdoor_c: Math.round(clock.outdoor * 10) / 10,
            sun_w_m2: Math.round(clock.sun),
            priority: clock.mode === 'heating' ? 'heating season: keep the heat in' : 'warm season: keep the top floor cool',
          },
          buildings: now.buildings.map((b) => ({
            name: b.name,
            storeys: b.storeys,
            [clock.mode === 'heating' ? 'top_floor_heating_kw' : 'top_floor_overheating_kw']: Math.round(b.load / 100) / 10,
            roof_heat_flow_kw: Math.round(b.roofFlow / 100) / 10,
            green_share: Math.round(b.green * 100) / 100,
            heating: b.heatingOff ? 'off for good (passive mode)' : clock.mode === 'heating' ? 'on' : 'not needed',
          })),
          sections: now.sections.map((s) => sectionFacts(s, s)),
          roof_heat_flow_kw: Math.round(now.roofFlow / 100) / 10,
          limit_kw: LIMIT_KW,
          green_share: Math.round(now.green * 100) / 100,
          passive_mode: passive,
          passive_possible_from_green_share: PASSIVE_SHARE,
          recent_changes_by_people: mem.changes,
          your_last_action: mem.last,
          minutes_since_people_last_changed_the_roof: Math.round((Date.now() - mem.lastChange) / 6000) / 10,
          energy_saved_since_opening_kwh: Math.round(saved),
          allowed_actions: actions,
        },
      }
    },
    [],
  )

  // Apply a change to sections, and remember what it did to the heat flow.
  const apply = useCallback(
    (changes) => {
      const { state, clock } = live.current
      const next = { ...state }
      for (const [id, st] of Object.entries(changes)) next[id] = st
      setState(next)
      live.current.state = next
      return dayMean(roof, next, clock) - dayMean(roof, state, clock)
    },
    [roof],
  )

  const work = useCallback(async () => {
    const mem = memory.current
    if (mem.thinking || mem.queue.length === 0) return
    const { offline } = live.current
    const job = mem.queue.shift()
    if (offline) {
      if (job.request) job.done(false)
      return
    }
    mem.thinking = true
    setBusy(true)
    const { allowed, payload } = situation(job.trigger, job.request)
    const { clock } = live.current
    const entry = { time: new Date(), when: `${MONTHS[clock.month]}, ${String(Math.floor(clock.hour)).padStart(2, '0')}:00`, trigger: job.label }
    if (job.trigger.kind === 'change') mem.changes = []
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (r.status === 404) {
        setOffline(true)
        if (job.request) job.done(false)
        return
      }
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      Object.assign(entry, { noticed: d.noticed, say: d.say, action: d.action, reason: d.reason })
      if (!allowed.actions.includes(d.action)) {
        entry.action = 'rejected'
        entry.reason = `It chose "${d.action}", which it wasn't allowed to here. ${d.reason}`
      }
      if (job.request) job.done(entry.action === 'allow')
      // The endpoint already checks the ids; check again here against the state right now.
      const { state } = live.current
      const ids = (d.sections ?? []).filter((id) => allowed.sections.includes(id) && state[id]?.use === 'free' && !state[id].locked)
      let effect = null
      if (entry.action === 'grow') {
        const grow = ids.filter((id) => state[id].cover < 2).slice(0, MAX_GROW)
        entry.ids = grow
        effect = apply(Object.fromEntries(grow.map((id) => [id, { ...state[id], cover: state[id].cover + 1 }])))
      } else if (entry.action === 'lock') {
        const lock = ids.slice(0, MAX_LOCK)
        entry.ids = lock
        effect = apply(Object.fromEntries(lock.map((id) => [id, { ...state[id], cover: 2, locked: true }])))
      } else if (entry.action === 'passive') {
        setPassive(true)
      }
      if (effect != null) entry.effect = effect
      if (entry.action !== 'none' && entry.action !== 'rejected')
        mem.last = { action: entry.action, sections: entry.ids ?? job.request?.sections ?? [], heat_flow_change_w_day_average: effect == null ? null : Math.round(effect), when: entry.when }
    } catch (e) {
      entry.action = 'error'
      entry.reason = e.message
      if (job.request) job.done(false)
    } finally {
      mem.thinking = false
      setBusy(false)
    }
    setLog((l) => [entry, ...l])
    setTimeout(() => work(), 0)
  }, [situation, apply])

  // Put a reason to think in the queue. Requests go first; a second comment, minute or season replaces the first.
  const think = useCallback(
    (trigger, label, request) =>
      new Promise((done) => {
        const mem = memory.current
        if (!request) mem.queue = mem.queue.filter((j) => j.request || j.trigger.kind !== trigger.kind)
        const job = { trigger, label, request, done }
        if (request) mem.queue.unshift(job)
        else mem.queue.push(job)
        work()
        if (!request) done(null)
      }),
    [work],
  )

  const commentTimer = useRef(null)
  const comment = useCallback(() => {
    clearTimeout(commentTimer.current)
    commentTimer.current = setTimeout(() => think({ kind: 'change' }, 'your changes'), COMMENT_AFTER_MS)
  }, [think])

  // A click or a drawing. Some changes go to the roof first; the roof may refuse them.
  const change = useCallback(
    async (kind, ids, label) => {
      const { state, clock } = live.current
      const mem = memory.current
      const plain = {}, asked = {}
      const lockedIds = []
      for (const id of ids) {
        const st = state[id]
        const next = target(st, kind)
        if (!next) continue
        if (st.locked) {
          lockedIds.push(id)
          continue
        }
        const s = roof.sections.find((x) => x.id === id)
        const winterLoss = clock.season === 'winter' && exposed(s) && losesPlants(st, next)
        const plantOnTerrace = st.use !== 'free' && cover(next) > 0
        if (winterLoss || plantOnTerrace) asked[id] = next
        else plain[id] = next
      }
      if (lockedIds.length) setNotice(`${lockedIds.join(', ')}: planted for good by the roof. It can't be changed.`)
      else setNotice(null)
      const record = (changes, effect) => {
        mem.changes = [
          ...mem.changes,
          ...Object.keys(changes).map((id) => ({ section: id, what: label, from: describe(state[id]), to: describe(changes[id]) })),
        ].slice(-12)
        mem.changes[mem.changes.length - 1].heat_flow_change_w_day_average = Math.round(effect)
        mem.lastChange = Date.now()
      }
      if (Object.keys(plain).length) {
        record(plain, apply(plain))
        comment()
      }
      if (Object.keys(asked).length) {
        const { now } = live.current
        const facts = now.sections.filter((s) => s.id in asked).map((s) => sectionFacts(s, s))
        const change = dayMean(roof, { ...live.current.state, ...asked }, clock) - dayMean(roof, live.current.state, clock)
        const request = {
          what: label,
          sections: Object.keys(asked),
          from: facts.map((f) => `${f.id}: ${f.plants === 'bare' ? f.use : f.plants + ' plants'}`),
          to: Object.keys(asked).map((id) => `${id}: ${describe(asked[id])}`),
          heat_flow_change_w_day_average: Math.round(change),
          why_you_are_asked:
            clock.season === 'winter' && Object.keys(asked).some((id) => exposed(roof.sections.find((x) => x.id === id)))
              ? 'it removes plants in winter from exposed sections (north side or corners)'
              : 'it puts plants where people use the roof as a terrace or path',
          sections_facts: facts,
        }
        const ok = await think({ kind: 'request' }, `your request: ${label} on ${Object.keys(asked).join(', ')}`, request)
        if (ok) record(asked, apply(asked))
      }
    },
    [roof, apply, comment, think],
  )

  // Once a minute by itself; when the season changes; when the heat flow passes the limit.
  useEffect(() => {
    if (!active || paused) return
    const t = setInterval(() => think({ kind: 'minute' }, 'its own minute: where is it losing most?'), THINK_EVERY_MS)
    return () => clearInterval(t)
  }, [active, paused, think])

  const season = clock.season
  const firstSeason = useRef(true)
  useEffect(() => {
    if (firstSeason.current) {
      firstSeason.current = false
      return
    }
    if (active) think({ kind: 'season', season }, `the season turned: ${season}`)
  }, [season]) // eslint-disable-line react-hooks/exhaustive-deps

  const over = !!now && now.roofFlow > LIMIT_KW * 1000
  useEffect(() => {
    if (!active || !over || passive) return
    const mem = memory.current
    if (Date.now() - mem.limitAt < LIMIT_PAUSE_MS) return
    mem.limitAt = Date.now()
    think({ kind: 'limit', roof_heat_flow_kw: Math.round(now.roofFlow / 100) / 10 }, `heat flow over ${LIMIT_KW} kW`)
  }, [over, active, passive]) // eslint-disable-line react-hooks/exhaustive-deps

  return { state, clock, now, passive, paused, setPaused, log, busy, offline, saved, notice, change }
}
