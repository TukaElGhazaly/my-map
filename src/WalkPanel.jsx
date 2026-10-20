// The walking view: the panel with buildings and residents, and its legend.
import { MINUTES, WALK_M_PER_MIN, BAND_M, SNAP_M } from './reach.js'
import { USE_COLORS, REACH_COLORS, useLabel } from './colors.js'

const fmt = (n) => n.toLocaleString('en-GB')

export function WalkPanel({ reach, busy }) {
  return (
    <>
      <p className="hint">
        {busy
          ? 'Calculating…'
          : reach?.start
            ? `Walking from the street node ${Math.round(reach.start.snapDistance)} m from your click. Click again to move.`
            : 'Click on the ground to start a walk.'}
      </p>
      {reach && !reach.start && !busy && (
        <p className="warning">No walkable street within {SNAP_M} m of this point. Try a spot closer to a street.</p>
      )}

      <table>
        <thead>
          <tr>
            <th>Walk</th>
            <th>Buildings</th>
            <th>Residents</th>
            <th title="Census cells that overlap the area but have no published resident count">No figure</th>
          </tr>
        </thead>
        <tbody>
          {MINUTES.map((m, i) => {
            const level = reach?.levels?.[i]
            return (
              <tr key={m}>
                <td>
                  <span className="swatch" style={{ background: REACH_COLORS[i] }} />
                  {m} min
                </td>
                <td>{level ? fmt(level.buildings) : '–'}</td>
                <td>{level ? `≈ ${fmt(level.residents)}` : '–'}</td>
                <td>{level ? `${level.withoutFigure} ${level.withoutFigure === 1 ? 'cell' : 'cells'}` : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="method">
        <p>
          <strong>Walking speed</strong>: 4.8 km/h, which is {WALK_M_PER_MIN} m per minute, along the walkable
          streets, paths and squares of the pedestrian network, starting at the street node nearest to your click.
        </p>
        <p>
          <strong>Area</strong>: the street segments you reach in that time, including the reachable part of the
          last one, with a band of {BAND_M} m on each side, joined into one shape. A building counts when it
          touches the area. Each longer walk includes the shorter ones.
        </p>
        <p>
          <strong>Residents</strong>: from the Zensus 2022 grid of 100 m cells. Every cell that overlaps the area
          adds its population times the share of the cell's area that lies inside. The sum is rounded to the
          nearest 10.
        </p>
        <p>
          <strong>Cells without a figure</strong>: some cells have no published resident count. They are not
          zero; they are left out of the sum, and "No figure" says how many overlap the area.
        </p>
      </div>
    </>
  )
}

export function WalkLegend({ uses }) {
  return (
    <>
      <h2>Main use</h2>
      <ul className="two-columns">
        {uses.map((u) => (
          <li key={u}>
            <span className="swatch" style={{ background: USE_COLORS[u] ?? USE_COLORS.undefined }} />
            {useLabel(u)}
          </li>
        ))}
      </ul>
      <h2>Reached within</h2>
      <ul>
        {MINUTES.map((m, i) => (
          <li key={m}>
            <span className="swatch" style={{ background: REACH_COLORS[i] }} />
            {m} minutes
          </li>
        ))}
      </ul>
    </>
  )
}

export function walkColors(buildings, reach) {
  return buildings.map((b, i) => {
    const level = reach?.levelOf ? reach.levelOf[i] : -1
    return level >= 0 ? REACH_COLORS[level] : USE_COLORS[b.use] ?? USE_COLORS.undefined
  })
}
