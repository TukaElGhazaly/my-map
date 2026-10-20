// An energy-flow (Sankey) diagram: heat flows in on the left, through the building, out on the right.
// The width of each band is the amount of energy. In equals out.

const WIDTH = 308
const BAR = 10 // width of the node bars
const LEFT_X = 92
const RIGHT_X = WIDTH - 92 - BAR
const MID_X = WIDTH / 2 - BAR / 2
const FLOW_HEIGHT = 170 // height of all the energy together, in pixels
const GAP = 7
const LABEL_STEP = 24 // labels never come closer than this

export function formatEnergy(kwh) {
  if (kwh >= 1e6) return `${(kwh / 1e6).toFixed(1)} GWh`
  if (kwh >= 1e4) return `${Math.round(kwh / 1e3).toLocaleString('en-GB')} MWh`
  if (kwh >= 1e3) return `${(kwh / 1e3).toFixed(1)} MWh`
  return `${Math.round(kwh)} kWh`
}

function stack(items, scale, top) {
  let y = top
  return items.map((it) => {
    const h = it.value * scale
    const node = { ...it, y, h }
    y += h + GAP
    return node
  })
}

// Push labels apart so they don't overlap.
function labelPositions(nodes) {
  let last = -Infinity
  return nodes.map((n) => {
    const y = Math.max(n.y + n.h / 2, last + LABEL_STEP)
    last = y
    return y
  })
}

function band(x1, y1a, y1b, x2, y2a, y2b) {
  const m = (x1 + x2) / 2
  return `M${x1},${y1a} C${m},${y1a} ${m},${y2a} ${x2},${y2a} L${x2},${y2b} C${m},${y2b} ${m},${y1b} ${x1},${y1b} Z`
}

// `inflows` and `outflows`: [{ key, label, value, color }], with equal sums.
export default function Sankey({ inflows, outflows }) {
  const ins = inflows.filter((f) => f.value > 0)
  const outs = outflows.filter((f) => f.value > 0)
  const total = ins.reduce((s, f) => s + f.value, 0)
  if (!total) return null
  const scale = FLOW_HEIGHT / total
  const rightH = FLOW_HEIGHT + GAP * (outs.length - 1)
  const leftH = FLOW_HEIGHT + GAP * (ins.length - 1)
  const top = 10
  const height = Math.max(rightH, leftH) + top * 2
  const left = stack(ins, scale, top + (Math.max(rightH, leftH) - leftH) / 2)
  const right = stack(outs, scale, top + (Math.max(rightH, leftH) - rightH) / 2)
  const midTop = top + (Math.max(rightH, leftH) - FLOW_HEIGHT) / 2
  const leftLabels = labelPositions(left)
  const rightLabels = labelPositions(right)
  const svgHeight = Math.max(height, ...leftLabels.map((y) => y + 16), ...rightLabels.map((y) => y + 16))
  const pct = (v) => `${Math.round((v / total) * 100)}%`

  let midIn = midTop
  let midOut = midTop
  return (
    <svg className="sankey" viewBox={`0 0 ${WIDTH} ${svgHeight}`} width="100%" role="img" aria-label="Energy flow diagram">
      {left.map((n) => {
        const y = midIn
        midIn += n.h
        return <path key={n.key} d={band(LEFT_X + BAR, n.y, n.y + n.h, MID_X, y, y + n.h)} fill={n.color} opacity="0.5" />
      })}
      {right.map((n) => {
        const y = midOut
        midOut += n.h
        return <path key={n.key} d={band(MID_X + BAR, y, y + n.h, RIGHT_X, n.y, n.y + n.h)} fill={n.color} opacity="0.5" />
      })}
      <rect x={MID_X} y={midTop} width={BAR} height={FLOW_HEIGHT} fill="#555" />
      {left.map((n, i) => (
        <g key={n.key}>
          <rect x={LEFT_X} y={n.y} width={BAR} height={Math.max(n.h, 1)} fill={n.color} />
          <text x={LEFT_X - 5} y={leftLabels[i] - 2} textAnchor="end" className="sankey-name">{n.label}</text>
          <text x={LEFT_X - 5} y={leftLabels[i] + 10} textAnchor="end" className="sankey-value">
            {formatEnergy(n.value)} · {pct(n.value)}
          </text>
        </g>
      ))}
      {right.map((n, i) => (
        <g key={n.key}>
          <rect x={RIGHT_X} y={n.y} width={BAR} height={Math.max(n.h, 1)} fill={n.color} />
          <text x={RIGHT_X + BAR + 5} y={rightLabels[i] - 2} className="sankey-name">{n.label}</text>
          <text x={RIGHT_X + BAR + 5} y={rightLabels[i] + 10} className="sankey-value">
            {formatEnergy(n.value)} · {pct(n.value)}
          </text>
        </g>
      ))}
    </svg>
  )
}
