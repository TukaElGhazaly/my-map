// The topology view: street network syntax, party walls, blocks and courtyards,
// green and blue networks, and street canyons, along the transect from the Bauhaus to the station.
import { CELL_M } from './heat.js'
import { useLabel } from './colors.js'
import {
  RADII, GAPS, CELL, CORRIDOR_M, streetSyntax, blocksAndCourtyards, buildingAdjacency, streetCanyons,
  greenPatches, compareCorridor, distanceToLine,
} from './topology.js'

export function computeTopology(data, grid) {
  const syntax = streetSyntax(data.net)
  const blocks = blocksAndCourtyards(grid)
  const adjacency = buildingAdjacency(data.buildings, grid, blocks.cls)
  const canyons = streetCanyons(data.net, grid)
  const green = greenPatches(grid)
  const [from, to] = data.landmarks.map((l) => [l.x, l.y])
  const corridor = compareCorridor({ net: data.net, buildings: data.buildings, grid, syntax, canyons, blocks, adjacency, green, from, to })
  return { syntax, blocks, adjacency, canyons, green, corridor, from, to }
}

// ---------- colours ----------

// Space syntax maps are coloured by rank, from blue (lowest tenth) to red (highest tenth).
const DECILES = ['#2c3e94', '#3a6fb0', '#4d9dc4', '#74c2b8', '#a8d88f', '#dbe86b', '#f6d44c', '#f6a33a', '#ea6a2c', '#c8262a']
function deciles(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const out = new Array(values.length)
  order.forEach(([, i], r) => (out[i] = Math.min(9, Math.floor((r / values.length) * 10))))
  return out
}

const CANYON_CLASSES = [
  { max: 0.0001, label: 'no walls on both sides', color: '#d9d6cf' },
  { max: 0.3, label: 'H/W under 0.3: open', color: '#fee391' },
  { max: 0.6, label: '0.3–0.6', color: '#fe9929' },
  { max: 1, label: '0.6–1', color: '#cc4c02' },
  { max: 2, label: '1–2: canyon', color: '#8c2d04' },
  { max: Infinity, label: '2 and more: deep canyon', color: '#3f0f02' },
]
const DEGREE_CLASSES = [
  { degree: 1, label: 'dead end', color: '#c8262a' },
  { degree: 2, label: 'bend, no junction', color: '#bdbab3' },
  { degree: 3, label: '3 ways (T or Y)', color: '#f6a33a' },
  { degree: 4, label: '4 ways (crossing)', color: '#3a6fb0' },
  { degree: 5, label: '5 or more ways', color: '#2c3e94' },
]
const GROUP_CLASSES = [
  { max: 1, label: 'stands alone', color: '#d9d6cf' },
  { max: 3, label: '2–3 buildings', color: '#c6dbef' },
  { max: 10, label: '4–10', color: '#6baed6' },
  { max: 30, label: '11–30', color: '#2171b5' },
  { max: Infinity, label: '31 and more', color: '#08306b' },
]
const CONTINUITY_STOPS = [
  { max: 0.25, label: 'under 25%: open, permeable', color: '#fde8c8' },
  { max: 0.5, label: '25–50%', color: '#f4a582' },
  { max: 0.75, label: '50–75%', color: '#b2abd2' },
  { max: Infinity, label: '75% and more: closed', color: '#5e3c99' },
]
const COURTYARD_COLOR = '#00897b'
const NETWORK_COLORS = ['#1b7837', '#5aae61', '#a6dba0', '#d9f0d3']
const STREET_GROUND = '#f7f6f2'
const OTHER_GROUND = '#ebe8e1'
const NEUTRAL = '#e4e1da'
const SELECTED = '#c51b7d'

export const LAYERS = {
  integration: { label: 'Integration' },
  choice: { label: 'Choice' },
  degree: { label: 'Junctions' },
  party: { label: 'Party walls' },
  blocks: { label: 'Blocks & courtyards' },
  green: { label: 'Green & blue' },
  canyons: { label: 'Street canyons' },
}

export function streetStyle(net, topo, layer, radius) {
  const n = net.edges.length
  if (layer === 'integration' || layer === 'choice') {
    const r = topo.syntax.radii[radius]
    const d = deciles(layer === 'integration' ? r.integration : r.choiceNorm)
    return { colors: d.map((k) => DECILES[k]), widths: d.map((k) => (layer === 'choice' ? 2 + k * 0.9 : 5)) }
  }
  if (layer === 'canyons')
    return { colors: topo.canyons.map((c) => CANYON_CLASSES.find((k) => c.hw < k.max).color), widths: Array(n).fill(5) }
  if (layer === 'degree') return { colors: Array(n).fill('#8f8b84'), widths: Array(n).fill(2) }
  return null
}

export const nodeColors = (topo) =>
  topo.syntax.degree.map((d) => DEGREE_CLASSES[Math.min(d, 5) - 1]?.color ?? DEGREE_CLASSES[0].color)

export function topologyBuildingColors(buildings, topo, layer, pick) {
  return buildings.map((b, i) => {
    if (pick?.building === i) return SELECTED
    if (layer !== 'party') return NEUTRAL
    return GROUP_CLASSES.find((k) => topo.adjacency.groupSize[i] <= k.max).color
  })
}

function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function topologyImage(grid, topo, layer, networks) {
  if (layer !== 'blocks' && layer !== 'green') return null
  const rgba = new Uint8Array(grid.n * 4)
  const { cls, blockId, blocks } = topo.blocks
  const blockColors = blocks.map((b) => hexRgb(CONTINUITY_STOPS.find((k) => b.continuity < k.max).color))
  const water = new Set(['flowing water', 'standing water'].map((k) => grid.coverKeys.indexOf(k)))
  const street = hexRgb(STREET_GROUND), other = hexRgb(OTHER_GROUND), court = hexRgb(COURTYARD_COLOR)
  const nets = NETWORK_COLORS.map(hexRgb)
  const blue = [hexRgb('#2166ac'), hexRgb('#92c5de')]
  for (let c = 0; c < grid.n; c++) {
    let rgb
    if (layer === 'blocks') {
      rgb = cls[c] === CELL.street ? street : cls[c] === CELL.courtyard ? court : blockColors[blockId[c]] ?? other
    } else {
      const p = topo.green.patchId[c]
      const k = p >= 0 ? networks.networkOf[p] : -1
      if (k < 0) rgb = cls[c] === CELL.street ? street : other
      else if (water.has(grid.cover[c])) rgb = blue[k === 0 ? 0 : 1]
      else rgb = nets[Math.min(k, 3)]
    }
    rgba.set(rgb, c * 4)
    rgba[c * 4 + 3] = 255
  }
  return rgba
}

// Lines to draw: party walls between building middles, or the gaps that join green patches.
export function topologyLines(buildings, topo, layer, networks) {
  if (layer === 'party') {
    const mid = buildings.map((b) => {
      const r = b.rings[0]
      return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length, b.height + 1]
    })
    return topo.adjacency.links.map(({ i, j }) => [...mid[i], ...mid[j]])
  }
  if (layer === 'green') return networks.links.map((l) => [l.from[0], l.from[1], 3, l.to[0], l.to[1], 3])
  return null
}

// What lies under a click: a building, a street segment within 10 m, or a piece of ground.
export function topologyPick(data, grid, topo, x, y, building) {
  if (building != null) return { building }
  let best = -1, bestD = 10
  data.net.edges.forEach((e, k) => {
    for (let i = 1; i < e.pts.length; i++) {
      const d = distanceToLine(e.pts[i - 1], e.pts[i], x, y)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
  })
  if (best >= 0) return { segment: best }
  const i = Math.floor((x - grid.x0) / CELL_M), j = Math.floor((y - grid.y0) / CELL_M)
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return null
  return { cell: j * grid.nx + i }
}

// ---------- the panel ----------

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–')
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–')

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

function rankOf(values, v) {
  let below = 0
  for (const x of values) if (x < v) below++
  return Math.round((below / values.length) * 100)
}

function Picked({ data, grid, topo, pick, networks }) {
  if (!pick) return null
  if (pick.building != null) {
    const b = data.buildings[pick.building]
    const f = topo.adjacency.facade[pick.building]
    const total = f.party + f.street + f.yard + f.courtyard || 1
    const n = topo.adjacency.neighbours[pick.building]
    return (
      <div className="probe">
        <h3>Building {b.id}</h3>
        <p className="hint">{useLabel(b.use)}, {fmt(b.height, 1)} m</p>
        <table className="facts">
          <tbody>
            <tr><td>Shares walls with</td><td>{n} {n === 1 ? 'building' : 'buildings'}</td></tr>
            <tr><td>Group joined by party walls</td><td>{topo.adjacency.groupSize[pick.building]} buildings</td></tr>
            <tr><td>Facade: party wall</td><td>{pct(f.party / total)}</td></tr>
            <tr><td>Facade: faces the street</td><td>{pct(f.street / total)}</td></tr>
            <tr><td>Facade: faces an open yard</td><td>{pct(f.yard / total)}</td></tr>
            <tr><td>Facade: faces an enclosed courtyard</td><td>{pct(f.courtyard / total)}</td></tr>
          </tbody>
        </table>
      </div>
    )
  }
  if (pick.segment != null) {
    const k = pick.segment
    const e = data.net.edges[k]
    const { n, r800 } = topo.syntax.radii
    const c = topo.canyons[k]
    return (
      <div className="probe">
        <h3>Street segment, {fmt(e.length)} m</h3>
        <p className="hint">“Higher than x%” compares it with all other segments.</p>
        <table className="facts">
          <tbody>
            <tr><td>Integration, 800 m</td><td>{fmt(r800.integration[k], 2)} · higher than {rankOf(r800.integration, r800.integration[k])}%</td></tr>
            <tr><td>Integration, whole network</td><td>{fmt(n.integration[k], 2)} · higher than {rankOf(n.integration, n.integration[k])}%</td></tr>
            <tr><td>Choice, 800 m</td><td>{fmt(r800.choice[k])} routes · higher than {rankOf(r800.choiceNorm, r800.choiceNorm[k])}%</td></tr>
            <tr><td>Ways at its two ends</td><td>{topo.syntax.degree[e.a]} and {topo.syntax.degree[e.b]}</td></tr>
            <tr><td>Height ÷ width</td><td>{c.hw > 0 ? fmt(c.hw, 2) : 'no walls on both sides'}</td></tr>
            <tr><td>Edges lined by walls (within 25 m)</td><td>{pct(c.enclosure)}</td></tr>
            <tr><td>Mean wall height</td><td>{c.height ? `${fmt(c.height, 1)} m` : '–'}</td></tr>
          </tbody>
        </table>
      </div>
    )
  }
  const c = pick.cell
  const kind = topo.blocks.cls[c]
  const patch = topo.green.patchId[c]
  const block = topo.blocks.blocks[topo.blocks.blockId[c]]
  const nw = patch >= 0 && networks.networkOf[patch] >= 0 ? networks.networks[networks.networkOf[patch]] : null
  return (
    <div className="probe">
      <h3>{kind === CELL.street ? 'Street space' : kind === CELL.courtyard ? 'Enclosed courtyard' : 'Open ground in a block'}</h3>
      <table className="facts">
        <tbody>
          {block && (
            <>
              <tr><td>Block area</td><td>{fmt(block.area / 1e4, 2)} ha</td></tr>
              <tr><td>Block covered by buildings</td><td>{pct(block.coverage)}</td></tr>
              <tr><td>Street edge that is building</td><td>{pct(block.continuity)}</td></tr>
              <tr><td>Enclosed courtyards in the block</td><td>{fmt(block.courtyardArea)} m²</td></tr>
            </>
          )}
          {nw && (
            <>
              <tr><td>Green or blue patch</td><td>{topo.green.patches[patch].kind}, {fmt(topo.green.patches[patch].area / 1e4, 2)} ha</td></tr>
              <tr><td>Its network</td><td>{nw.patches} {nw.patches === 1 ? 'patch (isolated)' : 'patches'}, {fmt(nw.area / 1e4, 1)} ha</td></tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}

const COMPARE = [
  { key: 'integrationLocal', label: 'Integration, 800 m (mean)', f: (v) => fmt(v, 2) },
  { key: 'integrationGlobal', label: 'Integration, whole network', f: (v) => fmt(v, 2) },
  { key: 'choiceLocal', label: 'Choice, 800 m (normalised)', f: (v) => fmt(v, 2) },
  { key: 'junctionsPerKm2', label: 'Junctions (3+ ways) per km²', f: (v) => fmt(v) },
  { key: 'deadEnds', label: 'Dead ends', f: (v) => fmt(v) },
  { key: 'hw', label: 'Street height ÷ width (median)', f: (v) => fmt(v, 2) },
  { key: 'enclosure', label: 'Street edges lined by walls', f: pct },
  { key: 'partyWallShare', label: 'Buildings with a party wall', f: pct },
  { key: 'facadeParty', label: 'Facade that is party wall', f: pct },
  { key: 'facadeStreet', label: 'Facade facing the street', f: pct },
  { key: 'facadeCourtyard', label: 'Facade facing enclosed courtyards', f: pct },
  { key: 'continuity', label: 'Block edges built up', f: pct },
  { key: 'courtyardShare', label: 'Open ground in enclosed courtyards', f: pct },
  { key: 'greenShare', label: 'Open ground that is green or blue', f: pct },
]

export function TopologyPanel({ data, grid, topo, layer, setLayer, radius, setRadius, gap, setGap, pick, networks }) {
  if (!topo) return <p className="hint">Analysing the street network, blocks, courtyards and green spaces…</p>
  return (
    <>
      <div className="controls">
        <span>Show</span>
        <Choice options={LAYERS} value={layer} onChange={setLayer} />
        {(layer === 'integration' || layer === 'choice') && (
          <>
            <span>Radius</span>
            <Choice options={RADII} value={radius} onChange={setRadius} />
          </>
        )}
        {layer === 'green' && (
          <>
            <span>Patches join across gaps up to</span>
            <Choice options={GAPS} value={gap} onChange={setGap} />
          </>
        )}
      </div>
      <p className="hint">Click a street, a building or the ground for details.</p>
      <Picked data={data} grid={grid} topo={topo} pick={pick} networks={networks} />

      {layer === 'green' && (
        <div className="stats">
          <p>
            {networks.patchCount} green and blue patches form <strong>{networks.networks.length} networks</strong> at
            this gap. The largest holds {pct(networks.largestShare)} of all green and blue area;{' '}
            {networks.isolated} patches stay isolated.
          </p>
        </div>
      )}
      {layer === 'blocks' && (
        <div className="stats">
          <p>
            <strong>{topo.blocks.courtyards.filter((c) => c.area >= 50).length} enclosed courtyards</strong> of 50 m²
            or more ({fmt(topo.blocks.courtyards.reduce((s, c) => s + c.area, 0) / 1e4, 1)} ha in all), in{' '}
            {topo.blocks.blocks.filter((b) => b.area > 1000).length} blocks.
          </p>
        </div>
      )}
      {layer === 'party' && (
        <div className="stats">
          <p>
            <strong>{fmt(topo.adjacency.links.length)} party walls</strong> join buildings into groups; the largest
            group has {Math.max(...topo.adjacency.groupSize)} buildings.
          </p>
        </div>
      )}

      <h3>Along the transect: within {CORRIDOR_M} m of the line, and the whole kit</h3>
      <table className="facts compare">
        <thead>
          <tr>
            <th />
            <th>Corridor</th>
            <th>Whole kit</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.f(topo.corridor.corridor[row.key])}</td>
              <td>{row.f(topo.corridor.all[row.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="method">
        <p>
          <strong>Topology, not distance.</strong> These layers ask what is connected to what: which streets
          meet, which buildings share a wall, which open spaces you can reach without passing through a building,
          which green spaces are close enough to form one network.
        </p>
        <p>
          <strong>Integration and choice</strong> follow space syntax’s angular segment analysis on the pedestrian
          network: each segment is linked to the ones it meets, and a turn of 90° costs one step. Integration is high
          where all other segments can be reached with little turning; choice is high where many simplest routes pass
          through. Both are normalised after Hillier, Yang and Turner (2012) and coloured by tenths, blue lowest
          to red highest.
        </p>
        <p>
          <strong>Measured from the kit</strong>: the pedestrian network; footprints and heights (walls closer than
          0.5 m count as a party wall); land use plots, with the ground between plots as street space; enclosed
          courtyards and block edges on a {CELL_M} m grid; street height ÷ width from walls found within 40 m on
          each side.
        </p>
        <p>
          <strong>Limits</strong>: the kit ends at its edge, so streets near the edge look less integrated than they
          are; the network is drawn for walking, not an axial map of the classic kind; the kit has no trees or tree
          lines, so green networks only know parks, the cemetery, wasteland and water, not private gardens or
          street trees; a courtyard reached through a gateway in a building counts as enclosed.
        </p>
      </div>
    </>
  )
}

export function TopologyLegend({ layer }) {
  let title, items
  if (layer === 'integration' || layer === 'choice') {
    title = layer === 'integration' ? 'Integration: how easily reached, by tenths' : 'Choice: through-movement, by tenths (wider = more)'
    return (
      <>
        <h2>{title}</h2>
        <div className="ramp" style={{ background: `linear-gradient(to right, ${DECILES.join(', ')})` }} />
        <div className="ramp-ticks"><span>lowest</span><span>highest</span></div>
        <p className="legend-note">Lines: the transect and the {CORRIDOR_M} m corridor on each side.</p>
      </>
    )
  }
  if (layer === 'degree') [title, items] = ['Junctions: how many ways meet', DEGREE_CLASSES]
  if (layer === 'party') [title, items] = ['Buildings joined by party walls (lines link neighbours)', GROUP_CLASSES]
  if (layer === 'canyons') [title, items] = ['Street canyons: wall height ÷ street width', CANYON_CLASSES]
  if (layer === 'blocks')
    [title, items] = ['Blocks: share of the street edge that is building', [...CONTINUITY_STOPS, { label: 'enclosed courtyard', color: COURTYARD_COLOR }]]
  if (layer === 'green')
    [title, items] = [
      'Green and blue networks (lines: gaps they join across)',
      [
        { label: 'largest network', color: NETWORK_COLORS[0] },
        { label: 'second', color: NETWORK_COLORS[1] },
        { label: 'third', color: NETWORK_COLORS[2] },
        { label: 'smaller or isolated', color: NETWORK_COLORS[3] },
        { label: 'water', color: '#2166ac' },
      ],
    ]
  return (
    <>
      <h2>{title}</h2>
      <ul>
        {items.map((c) => (
          <li key={c.label}>
            <span className="swatch" style={{ background: c.color }} />
            {c.label}
          </li>
        ))}
      </ul>
      <p className="legend-note">Lines: the transect and the {CORRIDOR_M} m corridor on each side.</p>
    </>
  )
}
