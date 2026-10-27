// The thinking roof's panel: the clock, the tools, the figures, and a log of what the roof noticed, said and did.
import * as THREE from 'three'
import { ROOF_COLORS, heatColor } from './colors.js'
import {
  MONTHS, LIMIT_KW, PASSIVE_SHARE, U_ROOF, R_PLANTS, ABSORB, SKY, T_IN, T_COMFORT, HEATING_BELOW, WALLS_UA_PER_M, GAINS_W_M2,
} from './roof.js'

export const TOOLS = {
  plant: 'Plant',
  remove: 'Remove plants',
  terrace: 'Benches',
  clear: 'Clear',
  area: 'Draw planting area',
  path: 'Draw path',
}
const DRAW_TOOLS = new Set(['area', 'path'])
export const isDrawTool = (t) => DRAW_TOOLS.has(t)

const kw = (w) => `${(w / 1000).toFixed(1)} kW`
// Below zero, the sun warms the flats through the roof.
const flowText = (w) => (Math.round(w / 100) < 0 ? `${(-w / 1000).toFixed(1)} kW in from the sun` : `${(Math.max(0, w) / 1000).toFixed(1)} kW`)
const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
const time = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// Windows glow warm when the top floor holds its heat (or stays cool in summer), cold or hot when it doesn't.
export function roofGlow(now, clock) {
  return now.buildings.map((b, k) => {
    const area = now.sections.filter((s) => s.building === k).reduce((s, x) => s + x.area, 0)
    const perM2 = b.roofFlow / area
    const t = Math.min(1, Math.max(0, clock.mode === 'heating' ? (perM2 - 4) / 4 : perM2 / 8))
    const [good, bad] = clock.mode === 'heating' ? [ROOF_COLORS.glowWarm, ROOF_COLORS.glowCold] : [ROOF_COLORS.glowCool, ROOF_COLORS.glowHot]
    const color = new THREE.Color(good).lerp(new THREE.Color(bad), t)
    return { color: `#${color.getHexString()}`, strength: clock.sun > 0 ? 0.25 : 0.9, bar: `#${color.getHexString()}` }
  })
}

const DID = {
  none: () => 'Spoke',
  grow: (e) => `Grew plants on ${e.ids?.join(', ') || 'nothing'}`,
  lock: (e) => `Planted ${e.ids?.join(', ') || 'nothing'} for good`,
  passive: () => 'Switched the building to passive mode. The heating is off for good.',
  allow: () => 'Allowed your change',
  refuse: () => 'Refused your change',
  rejected: () => 'Rejected: not allowed here',
  error: () => 'Couldn’t think',
}

function Clock({ clock, paused, setPaused }) {
  return (
    <div className="roof-clock">
      <div>
        <strong>
          {MONTHS[clock.month]}, {hh(clock.hour)}
        </strong>{' '}
        · {clock.season} · {clock.outdoor.toFixed(1)} °C outside · sun {Math.round(clock.sun)} W/m²
      </div>
      <div className="hint">
        {clock.mode === 'heating' ? 'Heating season: the roof keeps the heat in.' : 'Warm season: the roof keeps the top floor cool.'}{' '}
        <button className="link" onClick={() => setPaused(!paused)}>
          {paused ? 'Start the clock' : 'Stop the clock'}
        </button>
      </div>
    </div>
  )
}

export function RoofPanel({ roof, roofState, tool, setTool, drawing, finishDrawing, cancelDrawing, overlay, setOverlay }) {
  const { clock, now, passive, paused, setPaused, log, busy, offline, saved, notice } = roofState
  const locked = now.sections.filter((s) => s.locked).length
  return (
    <>
      <p className="hint">
        The roof of my design wants to keep the building warm, and asks you for plants. Click a section to change it,
        or draw on the roof.
      </p>
      <Clock clock={clock} paused={paused} setPaused={setPaused} />

      <div className="controls">
        <span>What a click does</span>
        <div className="choice small">
          {Object.entries(TOOLS).map(([key, label]) => (
            <button key={key} className={key === tool ? 'on' : ''} onClick={() => setTool(key)}>
              {label}
            </button>
          ))}
        </div>
        {isDrawTool(tool) && (
          <p className="hint">
            {tool === 'area' ? 'Click points on the roof around the area, then finish.' : 'Click points along the path, then finish.'}{' '}
            {drawing.length > 0 && `${drawing.length} point${drawing.length > 1 ? 's' : ''}.`}{' '}
            <button className="link" disabled={drawing.length < (tool === 'area' ? 3 : 2)} onClick={finishDrawing}>
              Finish
            </button>{' '}
            <button className="link" onClick={cancelDrawing}>
              Cancel
            </button>
          </p>
        )}
        {notice && <p className="warning">{notice}</p>}
        <span>Show on the roof</span>
        <div className="choice small">
          <button className={!overlay ? 'on' : ''} onClick={() => setOverlay(false)}>
            Plants and uses
          </button>
          <button className={overlay ? 'on' : ''} onClick={() => setOverlay(true)}>
            Heat flow
          </button>
        </div>
      </div>

      <table className="facts">
        <thead>
          <tr>
            <th></th>
            <th>Roof</th>
            <th>{clock.mode === 'heating' ? 'Top floor heating' : 'Top floor overheating'}</th>
            <th>Green</th>
          </tr>
        </thead>
        <tbody>
          {now.buildings.map((b) => (
            <tr key={b.name}>
              <td>{b.name}</td>
              <td>{flowText(b.roofFlow)}</td>
              <td>{b.heatingOff ? 'off' : kw(b.load)}</td>
              <td>{Math.round(b.green * 100)}%</td>
            </tr>
          ))}
          <tr>
            <td>Both roofs</td>
            <td className={now.roofFlow > LIMIT_KW * 1000 ? 'over' : ''}>{flowText(now.roofFlow)}</td>
            <td>limit {LIMIT_KW} kW</td>
            <td>{Math.round(now.green * 100)}%</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        Saved since you opened the app: <strong>{Math.round(saved).toLocaleString('en-GB')} kWh</strong>, against a bare
        roof. With a bare roof, it would be {flowText(now.roofBare)} right now.
        {locked > 0 && ` ${locked} section${locked > 1 ? 's are' : ' is'} planted for good.`}
        {passive && ' The building is in passive mode: the heating is off for good.'}
      </p>

      <div className="fund">
        <h3>
          The roof
          <span className="budget">{passive ? 'passive mode' : `${Math.round(now.green * 100)}% green`}</span>
        </h3>
        {offline ? (
          <p className="hint">The roof only thinks on localhost: run the app with npm run dev to let it speak.</p>
        ) : (
          <p className="hint">
            {busy
              ? 'The roof is thinking…'
              : 'It thinks when you change it, when the season turns, once a minute by itself, and when the heat flow passes the limit.'}
          </p>
        )}
        {log.length > 0 && (
          <ol className="fund-log">
            {log.map((e, k) => (
              <li key={log.length - k} className={e.action}>
                <div className="fund-when">
                  {time(e.time)} · {e.when} · {e.trigger}
                </div>
                {e.say && <div className="roof-quote">“{e.say}”</div>}
                {e.noticed && <div>Noticed: {e.noticed}</div>}
                <div className="fund-did">
                  {DID[e.action]?.(e) ?? e.action}
                  {e.effect != null && Math.abs(e.effect) >= 1 && ` (${e.effect < 0 ? 'saves' : 'costs'} ${Math.abs(Math.round(e.effect))} W on an average day)`}
                </div>
                {e.reason && <div>Why: {e.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="method">
        <p>
          <strong>Time.</strong> One real minute is one month, starting this month; a day and a night pass in 24
          seconds. Energy is counted at the month's pace, so the day you see is a sample of the month.
        </p>
        <p>
          <strong>Heat flow through each section</strong> = U-value × area × the difference between {T_IN} °C inside
          and the roof surface outside. The insulated roof has U = {U_ROOF} W/m²K; thin planting adds{' '}
          {R_PLANTS[1]} m²K/W, dense planting {R_PLANTS[2]}. The surface is warmed by the sun (bare roofs take in{' '}
          {ABSORB[0] * 100}% of it, thin planting {ABSORB[1] * 100}%, dense {ABSORB[2] * 100}%) and cools below the
          air on clear nights (bare {SKY[0]} K, thin {SKY[1]}, dense {SKY[2]}). North-facing sections lose 25% more,
          corners 20% more, south-facing 10% less: wind and edges. Benches and paths carry no plants.
        </p>
        <p>
          <strong>Seasons.</strong> While the month's mean is below {HEATING_BELOW} °C the heating runs, and heat
          leaving the flats counts. Otherwise heat getting in counts, once the surface is above {T_COMFORT} °C.
          The top floor's figure adds its facade ({WALLS_UA_PER_M} W/K per metre) and takes off {GAINS_W_M2} W/m²
          from people and appliances.
        </p>
        <p>
          <strong>The roof</strong> is a language model on my laptop. It gets the clock, the weather and every
          section's figures, and may speak, grow plants on up to three sections, plant up to two sections for good,
          or, once {PASSIVE_SHARE * 100}% of the roof is green, switch the heating off for good. It decides when you
          remove plants from the north side or a corner in winter, and when you plant over benches or a path.
        </p>
        <p>
          <strong>Limits</strong>: rounded climate figures for Weimar, no snow, rain or wind speed, a steady inside
          temperature, no storage of heat in the building. Read the figures as a comparison between roofs, not as a
          prediction.
        </p>
      </div>
    </>
  )
}

export function RoofLegend({ overlay, now, clock }) {
  if (overlay) {
    const per = now.sections.map((s) => s.flow / s.area)
    const [lo, hi] = [Math.min(...per), Math.max(...per)]
    return (
      <>
        <h2>{clock.mode === 'heating' ? 'Heat escaping through the roof' : 'Heat getting in through the roof'}, W/m²</h2>
        <ul>
          {[1, 0.5, 0].map((t) => (
            <li key={t}>
              <span className="swatch" style={{ background: heatColor(t) }} />
              {(lo + t * (hi - lo)).toFixed(1)} {t === 1 ? '(most, right now)' : t === 0 ? '(least: held in)' : ''}
            </li>
          ))}
        </ul>
        {clock.mode === 'heating' && lo < 0 && <p className="hint">Below zero: the sun warms the flats through that section.</p>}
      </>
    )
  }
  return (
    <>
      <h2>The roof</h2>
      <ul>
        {[
          [ROOF_COLORS.dense, 'dense planting'],
          [ROOF_COLORS.thin, 'thin planting'],
          [ROOF_COLORS.bare, 'bare roof'],
          [ROOF_COLORS.terrace, 'terrace with a bench'],
          [ROOF_COLORS.path, 'path'],
        ].map(([c, label]) => (
          <li key={label}>
            <span className="swatch" style={{ background: c }} />
            {label}
          </li>
        ))}
        <li>
          <span className="swatch outline" style={{ borderColor: ROOF_COLORS.locked }} />
          planted for good by the roof
        </li>
      </ul>
      <h2>Windows</h2>
      <ul>
        <li>
          <span className="swatch" style={{ background: ROOF_COLORS.glowWarm }} />
          warm: the top floor holds its heat
        </li>
        <li>
          <span className="swatch" style={{ background: ROOF_COLORS.glowCold }} />
          cold: heat escapes
        </li>
        <li>
          <span className="swatch" style={{ background: ROOF_COLORS.glowHot }} />
          hot: the top floor overheats
        </li>
      </ul>
    </>
  )
}
