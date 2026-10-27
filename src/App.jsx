import { Suspense, useEffect, useMemo, useState } from 'react'
import City, { ReachAreas, StartMarker, GroundImage, GroundLine, StreetRibbons, NodeDots, LinkLines, Renovated } from './City.jsx'
import { loadKit, makeProjection, prepareBuildings, prepareCells, preparePlots } from './geo.js'
import { buildGrid, heatAt, summary, transect, roofTemperatures, cellAt, CELL_M } from './heat.js'
import { HeatPanel, HeatLegend, heatImage, heatBuildingColors } from './HeatPanel.jsx'
import { prepareNetwork, computeReach } from './reach.js'
import { measureEnvelopes, heatBalance, sumBalances } from './energy.js'
import { WalkPanel, WalkLegend, walkColors } from './WalkPanel.jsx'
import { EnergyPanel, EnergyLegend, energyColors } from './EnergyPanel.jsx'
import { useFund } from './fund.js'
import { greenNetworks, GAPS, CORRIDOR_M } from './topology.js'
import {
  TopologyPanel, TopologyLegend, computeTopology, streetStyle, nodeColors, topologyBuildingColors, topologyImage,
  topologyLines, topologyPick,
} from './TopologyPanel.jsx'
import { useRoof, loadRoof, sectionsInArea, sectionsOnPath } from './roof.js'
import { RoofScene } from './RoofScene.jsx'
import { RoofPanel, RoofLegend, TOOLS, isDrawTool, roofGlow } from './RoofPanel.jsx'

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const BAUHAUS_ID = '14780' // the Bauhaus-Universität main building, Geschwister-Scholl-Straße 8
const STATION = [11.3265, 50.9912] // Weimar Hauptbahnhof, at the north edge of the kit

const VIEWS = { walk: 'Walking reach', energy: 'Energy', heat: 'Heat', topology: 'Topology', roof: 'Thinking roof' }
const TITLES = {
  walk: 'How far can you walk?',
  energy: 'Where does the heat go?',
  heat: 'Where does the city get hot?',
  topology: 'How is the city connected?',
  roof: 'What does the roof want?',
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('walk')
  // walking
  const [reach, setReach] = useState(null)
  const [busy, setBusy] = useState(false)
  // energy
  const [metric, setMetric] = useState('demand')
  const [standard, setStandard] = useState('unrenovated')
  const [selected, setSelected] = useState(null)
  // heat
  const [grid, setGrid] = useState(null)
  const [layer, setLayer] = useState('ts')
  const [time, setTime] = useState('t15')
  const [probe, setProbe] = useState(-1)
  // topology
  const [topo, setTopo] = useState(null)
  const [topoLayer, setTopoLayer] = useState('integration')
  const [radius, setRadius] = useState('r800')
  const [gap, setGap] = useState('g30')
  const [topoPick, setTopoPick] = useState(null)
  // thinking roof
  const [roof, setRoof] = useState(null)
  const [tool, setTool] = useState('plant')
  const [drawing, setDrawing] = useState([])
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    loadKit()
      .then(({ kit, buildings, graph, zensus, plots }) => {
        const project = makeProjection(kit.center)
        const prepared = prepareBuildings(buildings, project)
        const counts = {}
        for (const b of prepared) counts[b.use] = (counts[b.use] || 0) + 1
        const bauhaus = prepared.findIndex((b) => b.id === BAUHAUS_ID)
        const ring = prepared[bauhaus].rings[0]
        const [sx, sy] = project(STATION)
        setData({
          size: kit.size_m,
          buildings: prepared,
          envelopes: measureEnvelopes(prepared),
          net: prepareNetwork(graph, project),
          cells: prepareCells(zensus, project),
          plots: preparePlots(plots, project),
          uses: Object.keys(counts).sort((a, b) => counts[b] - counts[a]),
          bauhaus,
          landmarks: [
            {
              label: 'Bauhaus main building',
              x: ring.reduce((s, p) => s + p[0], 0) / ring.length,
              y: ring.reduce((s, p) => s + p[1], 0) / ring.length,
              h: prepared[bauhaus].height,
            },
            { label: 'Weimar station', x: sx, y: sy, h: 10 },
          ],
        })
      })
      .catch((e) => setError(e.message))
  }, [])

  // The thinking roof: its sections are loaded the first time the view opens; it remembers everything after.
  useEffect(() => {
    if (view !== 'roof' || roof) return
    loadRoof().then(setRoof).catch((e) => setError(e.message))
  }, [view, roof])
  const roofState = useRoof(roof, view === 'roof')
  const glow = useMemo(() => roofState.now && roofGlow(roofState.now, roofState.clock), [roofState.now, roofState.clock])
  const chooseTool = (t) => {
    setTool(t)
    setDrawing([])
  }
  const onSection = (id, [x, y], z) => {
    if (isDrawTool(tool)) setDrawing((d) => [...d, [x, y, z]])
    else roofState.change(tool, [id], TOOLS[tool].toLowerCase())
  }
  const finishDrawing = () => {
    const ids = tool === 'area' ? sectionsInArea(roof, drawing) : sectionsOnPath(roof, drawing)
    roofState.change(tool, ids, tool === 'area' ? 'drew a planting area' : 'drew a path')
    setDrawing([])
  }

  // The renovation fund. Buildings it renovated stay at the new-build standard, whatever the switch says.
  const fund = useFund(data, standard, view === 'energy')
  const balances = useMemo(() => {
    if (!data) return null
    const renovated = new Set(fund.renovations.map((r) => r.index))
    return data.buildings.map((b, i) => heatBalance(b, data.envelopes[i], renovated.has(i) ? 'new' : standard))
  }, [data, standard, fund.renovations])
  const total = useMemo(() => {
    if (!data) return null
    const t = sumBalances(balances)
    t.floorArea = data.buildings.reduce((s, b, i) => s + (data.envelopes[i].heated ? b.floorArea : 0), 0)
    t.count = data.envelopes.filter((e) => e.heated).length
    return t
  }, [data, balances])

  // The grid takes a moment, so it is only built the first time the heat or topology view opens.
  useEffect(() => {
    if ((view !== 'heat' && view !== 'topology') || grid || !data) return
    const t = setTimeout(() => setGrid(buildGrid(data.size, data.buildings, data.plots, data.net)), 30)
    return () => clearTimeout(t)
  }, [view, grid, data])
  const heat = useMemo(() => grid && heatAt(grid, time), [grid, time])
  const heatStats = useMemo(() => heat && summary(grid, heat), [grid, heat])
  const roofTs = useMemo(() => heat && roofTemperatures(grid, heat, data.buildings.length), [grid, heat, data])
  const [bauhausPoint, stationPoint] = data ? data.landmarks.map((l) => [l.x, l.y]) : [null, null]
  const profile = useMemo(
    () => heat && transect(grid, heat, ...data.landmarks.map((l) => [l.x, l.y])),
    [grid, heat, data],
  )
  const image = useMemo(() => heat && heatImage(grid, heat, layer), [grid, heat, layer])

  // Topology: about a second of work, done once, the first time the view opens.
  useEffect(() => {
    if (view !== 'topology' || topo || !grid) return
    const t = setTimeout(() => setTopo(computeTopology(data, grid)), 30)
    return () => clearTimeout(t)
  }, [view, topo, grid, data])
  const networks = useMemo(() => topo && greenNetworks(topo.green, GAPS[gap].metres), [topo, gap])
  const ribbons = useMemo(() => topo && streetStyle(data.net, topo, topoLayer, radius), [data, topo, topoLayer, radius])
  const dots = useMemo(() => topo && nodeColors(topo), [topo])
  const topoImage = useMemo(() => topo && topologyImage(grid, topo, topoLayer, networks), [grid, topo, topoLayer, networks])
  const topoLines = useMemo(() => topo && topologyLines(data.buildings, topo, topoLayer, networks), [data, topo, topoLayer, networks])
  const corridorEdges = useMemo(() => {
    if (!data) return []
    const [[ax, ay], [bx, by]] = data.landmarks.map((l) => [l.x, l.y])
    const l = Math.hypot(bx - ax, by - ay)
    const ox = (-(by - ay) / l) * CORRIDOR_M, oy = ((bx - ax) / l) * CORRIDOR_M
    return [1, -1].map((s) => [[ax + s * ox, ay + s * oy], [bx + s * ox, by + s * oy]])
  }, [data])

  const colors = useMemo(() => {
    if (!data) return []
    if (view === 'walk' || view === 'roof') return walkColors(data.buildings, view === 'walk' ? reach : null)
    if (view === 'energy') return energyColors(data.buildings, data.envelopes, balances, metric, selected)
    if (view === 'topology') return topo ? topologyBuildingColors(data.buildings, topo, topoLayer, topoPick) : walkColors(data.buildings, null)
    return roofTs ? heatBuildingColors(data.buildings, roofTs, layer) : walkColors(data.buildings, null)
  }, [data, view, reach, balances, metric, selected, roofTs, layer, topo, topoLayer, topoPick])

  const pick = (x, y, building) => {
    if (view === 'roof') return // the roof listens to clicks on its own sections
    if (view === 'energy') {
      setSelected(building)
      if (building != null) fund.think(building)
      return
    }
    if (view === 'heat') {
      if (grid) setProbe(cellAt(grid, x, y))
      return
    }
    if (view === 'topology') {
      if (topo) setTopoPick(topologyPick(data, grid, topo, x, y, building))
      return
    }
    if (busy) return
    setBusy(true)
    // Let the panel show "Calculating…" before the work starts.
    setTimeout(() => {
      setReach(computeReach(data.net, data.buildings, data.cells, x, y))
      setBusy(false)
    }, 20)
  }

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!data) return <p className="message">Loading the city kit…</p>

  return (
    <div className="app">
      <City data={data} colors={colors} landmarks={data.landmarks} onPick={pick}>
        {view === 'walk' && reach?.levels && <ReachAreas levels={reach.levels} />}
        {view === 'walk' && reach?.start && <StartMarker start={reach.start} />}
        {view === 'roof' && roof && roofState.now && (
          <Suspense fallback={null}>
            <RoofScene roof={roof} roofState={roofState} overlay={overlay} onSection={onSection} drawing={drawing} glow={glow} lastSay={roofState.log.find((e) => e.say)?.say} />
          </Suspense>
        )}
        {view === 'energy' && <Renovated buildings={data.buildings} renovations={fund.renovations} />}
        {view === 'heat' && image && <GroundImage grid={grid} rgba={image} cell={CELL_M} />}
        {view === 'heat' && <GroundLine from={bauhausPoint} to={stationPoint} />}
        {view === 'topology' && topoImage && <GroundImage grid={grid} rgba={topoImage} cell={CELL_M} />}
        {view === 'topology' && ribbons && <StreetRibbons net={data.net} colors={ribbons.colors} widths={ribbons.widths} />}
        {view === 'topology' && topo && topoLayer === 'degree' && <NodeDots net={data.net} colors={dots} />}
        {view === 'topology' && topoLines && <LinkLines lines={topoLines} />}
        {view === 'topology' && <GroundLine from={bauhausPoint} to={stationPoint} />}
        {view === 'topology' &&
          corridorEdges.map(([a, b], k) => <GroundLine key={k} from={a} to={b} width={1.5} color="#6b6b6b" />)}
      </City>

      <aside className="panel">
        <div className="choice tabs">
          {Object.entries(VIEWS).map(([key, label]) => (
            <button key={key} className={key === view ? 'on' : ''} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
        <h1>{TITLES[view]}</h1>
        {view === 'walk' && <WalkPanel reach={reach} busy={busy} />}
        {view === 'roof' &&
          (roofState.now ? (
            <RoofPanel
              roof={roof}
              roofState={roofState}
              tool={tool}
              setTool={chooseTool}
              drawing={drawing}
              finishDrawing={finishDrawing}
              cancelDrawing={() => setDrawing([])}
              overlay={overlay}
              setOverlay={setOverlay}
            />
          ) : (
            <p className="hint">Loading the roof…</p>
          ))}
        {view === 'heat' && (
          <HeatPanel
            grid={grid}
            heat={heat}
            stats={heatStats}
            profile={profile}
            layer={layer}
            setLayer={setLayer}
            time={time}
            setTime={setTime}
            cell={probe}
          />
        )}
        {view === 'topology' && (
          <TopologyPanel
            data={data}
            grid={grid}
            topo={topo}
            layer={topoLayer}
            setLayer={setTopoLayer}
            radius={radius}
            setRadius={setRadius}
            gap={gap}
            setGap={setGap}
            pick={topoPick}
            networks={networks}
          />
        )}
        {view === 'energy' && (
          <EnergyPanel
            data={data}
            envelopes={data.envelopes}
            balances={balances}
            total={total}
            standard={standard}
            setStandard={setStandard}
            metric={metric}
            setMetric={setMetric}
            selected={selected}
            setSelected={setSelected}
            bauhaus={data.bauhaus}
            fund={fund}
          />
        )}
      </aside>

      <aside className="legend">
        {view === 'walk' && <WalkLegend uses={data.uses} />}
        {view === 'roof' && roofState.now && <RoofLegend overlay={overlay} now={roofState.now} clock={roofState.clock} />}
        {view === 'energy' && <EnergyLegend metric={metric} />}
        {view === 'heat' && <HeatLegend layer={layer} />}
        {view === 'topology' && <TopologyLegend layer={topoLayer} />}
      </aside>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
