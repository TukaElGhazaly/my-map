// The energy view: what the buildings are coloured by, the energy balance of the
// clicked building or the whole area as a flow diagram, and how it is worked out.
import Sankey, { formatEnergy } from './Sankey.jsx'
import { useLabel } from './colors.js'
import {
  STANDARDS, CLASSES, classOf, MIN_HEATED_HEIGHT_M, WINDOW_SHARE, KWH_PER_W_PER_K, GROUND_FACTOR,
  AIR_CHANGES_PER_H, INTERNAL_GAINS_KWH_M2, WINDOW_G, GAIN_USE,
} from './energy.js'

const UNHEATED_COLOR = '#d8d6d0'
const SELECTED_COLOR = '#2f4b7c'

export const METRICS = {
  demand: {
    label: 'Heat demand',
    title: 'Heat demand, kWh per m² floor area and year (energy certificate classes)',
    classes: CLASSES.map((c, i) => ({ ...c, label: `${c.label}  ${i ? CLASSES[i - 1].max : 0}${c.max === Infinity ? '+' : '–' + c.max}` })),
    value: (env, bal) => bal.perM2,
  },
  compactness: {
    label: 'Compactness',
    title: 'Outside surface ÷ volume (A/V, per metre). Lower is more compact and loses less heat',
    classes: [
      { max: 0.3, label: 'under 0.3', color: '#3f8f5a' },
      { max: 0.4, label: '0.3–0.4', color: '#9bbd5e' },
      { max: 0.5, label: '0.4–0.5', color: '#c8cf68' },
      { max: 0.6, label: '0.5–0.6', color: '#e3cf6a' },
      { max: 0.8, label: '0.6–0.8', color: '#e6b25f' },
      { max: 1.0, label: '0.8–1.0', color: '#de8d55' },
      { max: Infinity, label: '1.0 and more', color: '#b0413e' },
    ],
    value: (env) => env.compactness,
  },
  shared: {
    label: 'Shared walls',
    title: 'Share of the wall area that touches a heated neighbour. More shared walls lose less heat',
    classes: [
      { max: 0.001, label: 'none', color: '#b0413e' },
      { max: 0.2, label: 'under 20%', color: '#de8d55' },
      { max: 0.4, label: '20–40%', color: '#e3cf6a' },
      { max: 0.6, label: '40–60%', color: '#9bbd5e' },
      { max: Infinity, label: '60% and more', color: '#3f8f5a' },
    ],
    value: (env) => env.sharedShare,
  },
}

export function energyColors(buildings, envelopes, balances, metric, selected) {
  const m = METRICS[metric]
  return buildings.map((b, i) => {
    if (i === selected) return SELECTED_COLOR
    if (!envelopes[i].heated) return UNHEATED_COLOR
    const v = m.value(envelopes[i], balances[i])
    return m.classes.find((c) => v < c.max).color
  })
}

function cellAt(cells, x, y) {
  return cells.find(({ ring }) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  })
}

function centroid(ring) {
  const n = ring.length
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
}

function Choice({ options, value, onChange }) {
  return (
    <div className="choice">
      {Object.entries(options).map(([key, o]) => (
        <button key={key} className={key === value ? 'on' : ''} onClick={() => onChange(key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const fmt = (n, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })

function flows(balance) {
  return {
    inflows: [
      { key: 'heating', label: 'Heating', value: balance.in.heating, color: '#c8553d' },
      { key: 'internal', label: 'People, appliances', value: balance.in.internal, color: '#e0a458' },
      { key: 'sun', label: 'Sun via windows', value: balance.in.sun, color: '#efc94c' },
    ],
    outflows: [
      { key: 'walls', label: 'Walls', value: balance.out.walls, color: '#8d99ae' },
      { key: 'windows', label: 'Windows', value: balance.out.windows, color: '#6c8ebf' },
      { key: 'roof', label: 'Roof', value: balance.out.roof, color: '#a5a58d' },
      { key: 'ground', label: 'Ground floor', value: balance.out.ground, color: '#b7a99a' },
      { key: 'ventilation', label: 'Fresh air', value: balance.out.ventilation, color: '#9fb8c8' },
      { key: 'unused', label: 'Unused gains', value: balance.out.unusedGains, color: '#cfcac0' },
    ],
  }
}

export function EnergyPanel({ data, envelopes, balances, total, standard, setStandard, metric, setMetric, selected, setSelected, bauhaus }) {
  const b = selected != null ? data.buildings[selected] : null
  const env = selected != null ? envelopes[selected] : null
  const bal = selected != null ? balances[selected] : total
  const perM2 = bal ? (b ? bal.perM2 : total.heating / total.floorArea) : null
  const cls = perM2 != null ? classOf(perM2) : null
  const cell = b ? cellAt(data.cells, ...centroid(b.rings[0])) : null

  return (
    <>
      <div className="controls">
        <span>Colour by</span>
        <Choice options={METRICS} value={metric} onChange={setMetric} />
        <span>Insulation</span>
        <Choice options={STANDARDS} value={standard} onChange={setStandard} />
      </div>

      <div className="subject">
        <h2>
          {b ? (selected === bauhaus ? 'Bauhaus main building' : `Building ${b.id}`) : 'Whole area'}
          <span>{b ? `${useLabel(b.use)}, ${fmt(b.height, 1)} m, ${b.floors} floors` : `${fmt(total.count)} heated buildings`}</span>
        </h2>
        <div className="choice small">
          <button onClick={() => setSelected(bauhaus)} className={selected === bauhaus ? 'on' : ''}>Bauhaus main building</button>
          <button onClick={() => setSelected(null)} className={selected == null ? 'on' : ''}>Whole area</button>
        </div>
        {!b && <p className="hint">Click a building to see its own balance.</p>}
      </div>

      {b && !env.heated ? (
        <p className="hint">
          This building is under {MIN_HEATED_HEIGHT_M} m tall, so it is taken as unheated: a shed, garage or carport.
        </p>
      ) : (
        <>
          <table className="facts">
            <tbody>
              <tr>
                <td>Heat demand</td>
                <td>
                  {fmt(perM2)} kWh/m² a <span className="badge" style={{ background: cls.color }}>{cls.label}</span>
                </td>
              </tr>
              <tr>
                <td>Heating per year</td>
                <td>{formatEnergy(bal.heating)}</td>
              </tr>
              <tr>
                <td>Floor area</td>
                <td>{fmt(b ? b.floorArea : total.floorArea)} m²</td>
              </tr>
              {env && (
                <>
                  <tr>
                    <td>Compactness A/V</td>
                    <td>{fmt(env.compactness, 2)} per m</td>
                  </tr>
                  <tr>
                    <td>Walls shared with neighbours</td>
                    <td>{fmt(env.sharedShare * 100)}%</td>
                  </tr>
                  <tr>
                    <td>Census: main heating here</td>
                    <td>{cell?.heating ?? 'no figure'}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <h3>Energy flow over one heating season</h3>
          <Sankey {...flows(bal)} />
        </>
      )}

      <div className="method">
        <p>
          <strong>Heat flows from warm to cold.</strong> Through each surface it flows at its U-value × its area ×
          the temperature difference. A wall shared with a heated neighbour has almost no difference across it, so
          it loses almost nothing: compact blocks need less heat than detached houses.
        </p>
        <p>
          <strong>Energy is conserved.</strong> Over the heating season, the heat that comes in (heating, people and
          appliances, sun through windows) equals the heat that goes out (walls, windows, roof, ground floor, fresh
          air). Heating makes up whatever the free gains don't cover.
        </p>
        <p>
          <strong>Measured from the kit</strong>: footprints, heights and floor areas; walls that touch a heated
          neighbour (within 0.5 m), up to the neighbour's height; which way each outside wall faces.
        </p>
        <p>
          <strong>Assumed, not in the kit</strong>: U-values for the insulation standard chosen above
          (walls {STANDARDS[standard].wall}, windows {STANDARDS[standard].window}, roof {STANDARDS[standard].roof},
          ground {STANDARDS[standard].ground} W/m²K); {WINDOW_SHARE * 100}% of each outside wall is window; one W/K
          of heat loss costs {KWH_PER_W_PER_K} kWh a season (German reference climate, DIN V 4108-6); ground floor
          losses × {GROUND_FACTOR}; fresh air {AIR_CHANGES_PER_H} times the room air per hour; people and appliances{' '}
          {INTERNAL_GAINS_KWH_M2} kWh per m²; sun from 100 kWh/m² on north walls to 270 on south walls, glass lets{' '}
          {WINDOW_G * 100}% through; {GAIN_USE * 100}% of the gains replace heating. Buildings under{' '}
          {MIN_HEATED_HEIGHT_M} m are taken as unheated.
        </p>
        <p>
          <strong>Limits</strong>: the kit has no construction year or insulation, so every building gets the same
          standard; roofs are taken as flat at the building's highest point, so volume is too high for pitched
          roofs; every use is heated like housing; no shading by neighbours; no heating system losses. Read the
          figures as a comparison between forms, not as the real consumption of a building.
        </p>
      </div>
    </>
  )
}

export function EnergyLegend({ metric }) {
  const m = METRICS[metric]
  return (
    <>
      <h2>{m.title}</h2>
      <ul className={m.classes.length > 6 ? 'two-columns' : ''}>
        {m.classes.map((c) => (
          <li key={c.label}>
            <span className="swatch" style={{ background: c.color }} />
            {c.label}
          </li>
        ))}
      </ul>
      <ul>
        <li>
          <span className="swatch" style={{ background: UNHEATED_COLOR }} />
          unheated (under {MIN_HEATED_HEIGHT_M} m)
        </li>
        <li>
          <span className="swatch" style={{ background: SELECTED_COLOR }} />
          selected building
        </li>
      </ul>
    </>
  )
}
