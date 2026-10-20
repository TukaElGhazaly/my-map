// The heat view: surface temperature, evaporative cooling, albedo, sky view, night heat,
// mean radiant temperature and hotspots, along the transect from the Bauhaus to the station.
import {
  TIMES, DAY, MATERIALS, MIXES, CELL_M, WATER_C, HOTSPOT_SHARE, BUFFER_DROP_K, BUFFER_GREEN, classify,
} from './heat.js'

// ---------- colours ----------

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function ramp(stops) {
  const rgb = stops.map(([v, hex]) => [v, hexToRgb(hex)])
  return (v) => {
    if (!(v > rgb[0][0])) return rgb[0][1]
    for (let k = 1; k < rgb.length; k++)
      if (v <= rgb[k][0]) {
        const [v0, c0] = rgb[k - 1], [v1, c1] = rgb[k]
        const t = (v - v0) / (v1 - v0)
        return c0.map((x, i) => Math.round(x + (c1[i] - x) * t))
      }
    return rgb[rgb.length - 1][1]
  }
}

const HOT = [[20, '#2c7bb6'], [30, '#abd9e9'], [40, '#ffffbf'], [50, '#fdae61'], [60, '#d7191c']]
const RADIANT = [[30, '#4575b4'], [40, '#91bfdb'], [50, '#fee090'], [60, '#fc8d59'], [70, '#b2182b']]

export const LAYERS = {
  ts: {
    label: 'Surface temperature', unit: '°C', timed: true, stops: HOT,
    title: 'Surface temperature in the afternoon sun (°C)',
    value: (g, h, c) => h.ts[c],
  },
  latent: {
    label: 'Evaporative cooling', unit: 'W/m²', timed: true,
    stops: [[0, '#f3eee4'], [50, '#d9ef8b'], [150, '#91cf60'], [250, '#1a9850'], [380, '#00441b']],
    title: 'Latent heat flux: energy that goes into evaporation instead of heating the air (W/m²)',
    value: (g, h, c) => h.latent[c],
  },
  albedo: {
    label: 'Albedo', unit: '', timed: false,
    stops: [[0.05, '#262626'], [0.15, '#6b6b6b'], [0.25, '#b5b5b5'], [0.35, '#f5f5f5']],
    title: 'Albedo: the share of sunlight a surface reflects (assumed from the materials)',
    value: (g, h, c) => g.props[g.cover[c]].albedo,
  },
  svf: {
    label: 'Sky view', unit: '', timed: false,
    stops: [[0, '#3b0f70'], [0.25, '#8c2981'], [0.5, '#de4968'], [0.75, '#fe9f6d'], [1, '#fcfdbf']],
    title: 'Sky view factor: how much of the sky you see from the ground (measured from the buildings)',
    value: (g, h, c) => g.svf[c],
  },
  night: {
    label: 'Night heat', unit: 'K', timed: false,
    stops: [[0, '#fff5eb'], [3, '#fdbe85'], [6, '#fd8d3c'], [9, '#d94701'], [12, '#7f2704']],
    title: 'Night-time heat retention: how much warmer than open land, from the street geometry (K)',
    value: (g, h, c) => g.night[c],
  },
  tmrt: {
    label: 'Tmrt', unit: '°C', timed: true, stops: RADIANT,
    title: 'Mean radiant temperature: the heat a standing person receives from sun, sky, walls and ground (°C)',
    value: (g, h, c) => h.tmrt[c],
  },
  hotspots: {
    label: 'Hotspots & buffers', unit: '', timed: true, stops: RADIANT, title: null,
    value: (g, h, c) => h.tmrt[c],
  },
}

const ROOF_RGB = hexToRgb('#e4e1da')
const PRIVATE_RGB = hexToRgb('#ebe8e1')
const HOTSPOT_RGB = hexToRgb('#7a0019')
const BUFFER_RGB = hexToRgb('#1a7f45')
export const NEUTRAL_BUILDING = '#e4e1da'

// One colour per grid cell, as an RGBA picture.
export function heatImage(grid, heat, layer) {
  const L = LAYERS[layer]
  const colour = ramp(L.stops)
  const rgba = new Uint8Array(grid.n * 4)
  const unknown = grid.coverKeys.indexOf('unknown')
  for (let c = 0; c < grid.n; c++) {
    let rgb
    if (grid.cover[c] === unknown) rgb = PRIVATE_RGB
    else if (layer === 'hotspots') {
      const k = classify(grid, heat, c)
      rgb = k === 'hotspot' ? HOTSPOT_RGB : k === 'buffer' ? BUFFER_RGB : PRIVATE_RGB
    } else {
      const v = L.value(grid, heat, c)
      rgb = Number.isNaN(v) ? ROOF_RGB : colour(v)
    }
    rgba.set(rgb, c * 4)
    rgba[c * 4 + 3] = 255
  }
  return rgba
}

// Building colours: roofs in the colour of their own surface temperature, otherwise neutral.
export function heatBuildingColors(buildings, roofTs, layer) {
  if (layer !== 'ts') return buildings.map(() => NEUTRAL_BUILDING)
  const colour = ramp(HOT)
  return roofTs.map((t) => {
    if (Number.isNaN(t)) return NEUTRAL_BUILDING
    const [r, g, b] = colour(t)
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
  })
}

// ---------- small pieces ----------

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–')

function Choice({ options, value, onChange, disabled }) {
  return (
    <div className="choice">
      {Object.entries(options).map(([key, o]) => (
        <button key={key} className={key === value ? 'on' : ''} onClick={() => onChange(key)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Surface and radiant temperature along the transect, with green and built stretches marked.
function Profile({ points }) {
  const W = 308, H = 150, left = 26, right = 6, top = 8, bottom = 24
  const maxD = points.at(-1).d
  const x = (d) => left + (d / maxD) * (W - left - right)
  const y = (t) => top + (1 - (t - 20) / 50) * (H - top - bottom)
  const line = (key) => {
    let path = ''
    let pen = false
    for (const p of points) {
      const v = p[key]
      if (!Number.isFinite(v)) {
        pen = false
        continue
      }
      path += `${pen ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(Math.min(70, Math.max(20, v))).toFixed(1)}`
      pen = true
    }
    return path
  }
  const step = points[1].d - points[0].d
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Temperatures along the transect">
      {points.map((p, k) =>
        p.roof ? (
          <rect key={k} x={x(p.d)} y={top} width={x(step) - x(0) + 0.3} height={H - top - bottom} fill="#e9e6df" />
        ) : p.green >= BUFFER_GREEN ? (
          <rect key={k} x={x(p.d)} y={top} width={x(step) - x(0) + 0.3} height={H - top - bottom} fill="#d6ecd2" />
        ) : null,
      )}
      {[20, 30, 40, 50, 60, 70].map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="#ddd" strokeWidth="0.6" />
          <text x={left - 3} y={y(t) + 3} textAnchor="end" className="axis">{t}</text>
        </g>
      ))}
      <path d={line('ts')} fill="none" stroke="#e08214" strokeWidth="1.1" />
      <path d={line('tmrt')} fill="none" stroke="#7a0019" strokeWidth="1.1" />
      <text x={left} y={H - 8} className="axis">Bauhaus</text>
      <text x={W - right} y={H - 8} textAnchor="end" className="axis">Station</text>
      <text x={(left + W - right) / 2} y={H - 8} textAnchor="middle" className="axis">{fmt(maxD / 1000, 1)} km</text>
    </svg>
  )
}

// Where the absorbed energy goes, for each kind of surface: into the air (sensible) or into evaporation (latent).
function FluxBars({ rows }) {
  const max = Math.max(...rows.map((r) => Math.max(0, r.sensible) + r.latent))
  return (
    <table className="fluxes">
      <thead>
        <tr>
          <th>Surface</th>
          <th>°C</th>
          <th className="bars">
            <span className="key sensible" /> sensible <span className="key latent" /> latent, W/m²
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{fmt(r.ts)}</td>
            <td className="bars" title={`sensible ${fmt(r.sensible)} W/m², latent ${fmt(r.latent)} W/m²`}>
              <span className="bar sensible" style={{ width: `${(Math.max(0, r.sensible) / max) * 100}%` }} />
              <span className="bar latent" style={{ width: `${(r.latent / max) * 100}%` }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Probe({ grid, heat, cell }) {
  if (cell < 0) return null
  const key = grid.coverKeys[grid.cover[cell]]
  if (key === 'unknown')
    return (
      <div className="probe">
        <h3>{MIXES[key].label}</h3>
        <p className="hint">This ground lies outside every plot and more than 25 m from a street, so the model leaves it out.</p>
      </div>
    )
  const p = grid.props[grid.cover[cell]]
  const mix = Object.entries(MIXES[key].mix).map(([m, s]) => `${Math.round(s * 100)}% ${MATERIALS[m].label}`).join(', ')
  const k = classify(grid, heat, cell)
  const roof = grid.height[cell] > 0
  return (
    <div className="probe">
      <h3>
        {MIXES[key].label}
        {k && <span className={`tag ${k}`}>{k === 'hotspot' ? 'hotspot' : 'cooling buffer'}</span>}
      </h3>
      <p className="hint">{roof ? `Roof at ${fmt(grid.height[cell], 1)} m.` : `Assumed: ${mix}.`}</p>
      <table className="facts">
        <tbody>
          <tr><td>Surface temperature</td><td>{fmt(heat.ts[cell], 1)} °C</td></tr>
          {!roof && <tr><td>Mean radiant temperature</td><td>{fmt(heat.tmrt[cell], 1)} °C</td></tr>}
          <tr><td>In the sun</td><td>{heat.lit[cell] ? 'yes' : 'no, in a building’s shadow'}</td></tr>
          <tr><td>Net radiation</td><td>{fmt(heat.netRad[cell])} W/m²</td></tr>
          <tr><td>Sensible heat (warms the air)</td><td>{fmt(heat.sensible[cell])} W/m²</td></tr>
          <tr><td>Latent heat (evaporation)</td><td>{fmt(heat.latent[cell])} W/m²</td></tr>
          <tr><td>Into the ground</td><td>{fmt(heat.storage[cell])} W/m²</td></tr>
          <tr><td>Albedo</td><td>{fmt(p.albedo, 2)}</td></tr>
          {!roof && <tr><td>Sky view factor</td><td>{fmt(grid.svf[cell], 2)}</td></tr>}
          {!roof && <tr><td>Night heat retention</td><td>{fmt(grid.night[cell], 1)} K</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------- the panel ----------

export function HeatPanel({ grid, heat, stats, profile, layer, setLayer, time, setTime, cell }) {
  if (!grid || !heat) return <p className="hint">Calculating the sky view and shadows on a {CELL_M} m grid…</p>
  const timed = LAYERS[layer].timed
  return (
    <>
      <div className="controls">
        <span>Show</span>
        <Choice options={LAYERS} value={layer} onChange={setLayer} />
        <span>
          Time on {DAY.label}, air {TIMES[time].airC} °C{!timed && ' (this layer doesn’t change with the time)'}
        </span>
        <Choice options={TIMES} value={time} onChange={setTime} />
      </div>

      <p className="hint">
        Sun {fmt(heat.sun.altDeg)}° high from {fmt(heat.sun.azDeg)}° (south is 180°). Click any spot to see its
        energy balance.
      </p>

      {cell >= 0 && <Probe grid={grid} heat={heat} cell={cell} />}

      <div className="stats">
        <p>
          <span className="swatch" style={{ background: '#7a0019' }} />
          <strong>Hotspots</strong>: the hottest {HOTSPOT_SHARE * 100}% of streets, squares and parks, Tmrt from{' '}
          {fmt(heat.limits.hot)} °C: {fmt(stats.hotspotArea / 1e4, 1)} ha.
        </p>
        <p>
          <span className="swatch" style={{ background: '#1a7f45' }} />
          <strong>Cooling buffers</strong>: green places (at least {BUFFER_GREEN * 100}% trees or grass) at least{' '}
          {BUFFER_DROP_K} K cooler than open, sunlit street ({fmt(heat.limits.sunnyStreet)} °C), so Tmrt up to{' '}
          {fmt(heat.limits.cool)} °C: {fmt(stats.bufferArea / 1e4, 1)} ha.
        </p>
      </div>

      <h3>Along the transect, Bauhaus to station</h3>
      <p className="legend-line">
        <span className="key" style={{ background: '#e08214' }} /> surface temperature{' '}
        <span className="key" style={{ background: '#7a0019' }} /> Tmrt, °C{' '}
        <span className="key" style={{ background: '#d6ecd2' }} /> green{' '}
        <span className="key" style={{ background: '#e9e6df' }} /> through a building
      </p>
      <Profile points={profile} />

      <h3>Where the sun’s energy goes, by surface</h3>
      <FluxBars rows={stats.rows} />

      <div className="method">
        <p>
          <strong>Surface energy balance.</strong> Every 4 m square absorbs sunlight (less where its albedo is high)
          and longwave heat from the sky and from nearby walls, and radiates heat itself. What is left goes three
          ways: <em>sensible heat</em> warms the air, <em>latent heat</em> evaporates water from leaves and soil,
          and the rest is stored in the ground. Sealed surfaces can’t evaporate, so all of it heats the air and
          the surface gets hot; plants and moist soil turn a large share into evaporation and stay cooler.
        </p>
        <p>
          <strong>Canyons and sky view.</strong> Deep, narrow streets see little sky. By day they get shade, but
          their walls send heat back down, and at night they can’t radiate it away to the cold sky. The night layer
          uses Oke’s (1981) relation between sky view factor and the urban heat island: ΔT = 15.27 − 13.88 × SVF.
        </p>
        <p>
          <strong>Mean radiant temperature</strong> adds up the sun, sky, walls and ground that a standing person
          absorbs. Direct sun matters most: in the shade of buildings or trees it drops by 20 to 30 K.
        </p>
        <p>
          <strong>Measured from the kit</strong>: building footprints and heights (sky view factor in 16 directions
          up to 100 m, shadows for the sun’s position), land use per plot, street space between plots (up to 25 m
          from a street or path; ground further out, near the edge of the kit, is left out and shown in grey).
        </p>
        <p>
          <strong>Assumed, not in the kit</strong>: a clear day on {DAY.label} with the air at 27, 30 and 28 °C;
          clear-sky sunlight from the sun’s height; what each land use is made of (click a spot to see its mix);
          albedo, evaporation share and heat storage of each material; water stays at {WATER_C} °C; walls are 6 K
          warmer than the air and reflect 30% of the sun.
        </p>
        <p>
          <strong>Limits</strong>: the kit has no trees, so greenery is a share per land use, not real tree crowns,
          and street trees are missing; no satellite surface temperatures to check against; steady state, so no
          heat stored from the morning; one air temperature everywhere, no wind field; Tmrt is not a full comfort
          index (UTCI or PET would also need wind and humidity). Use it to compare places, not as a measurement.
        </p>
      </div>
    </>
  )
}

export function HeatLegend({ layer }) {
  const L = LAYERS[layer]
  if (layer === 'hotspots')
    return (
      <>
        <h2>Hotspots and cooling buffers</h2>
        <ul>
          <li><span className="swatch" style={{ background: '#7a0019' }} />hottest {HOTSPOT_SHARE * 100}% of public space (Tmrt)</li>
          <li><span className="swatch" style={{ background: '#1a7f45' }} />green cooling buffer</li>
          <li><span className="swatch" style={{ background: '#ebe8e1' }} />other ground</li>
        </ul>
      </>
    )
  const gradient = `linear-gradient(to right, ${L.stops
    .map(([v, c]) => `${c} ${((v - L.stops[0][0]) / (L.stops.at(-1)[0] - L.stops[0][0])) * 100}%`)
    .join(', ')})`
  return (
    <>
      <h2>{L.title}</h2>
      <div className="ramp" style={{ background: gradient }} />
      <div className="ramp-ticks">
        {L.stops.map(([v]) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      {layer === 'ts' && <p className="legend-note">Roofs are coloured by their own surface temperature.</p>}
      <p className="legend-note">The black line is the transect from the Bauhaus main building to the station.</p>
    </>
  )
}
