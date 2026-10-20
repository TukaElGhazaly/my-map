// Loading the city kit and turning longitude/latitude into metres.

const EARTH_RADIUS_M = 6371008.8
const RAD = Math.PI / 180

// A flat projection around the kit centre: x metres east, y metres north.
// Over 2 km the error is far below a metre.
export function makeProjection([lon0, lat0]) {
  const kx = EARTH_RADIUS_M * RAD * Math.cos(lat0 * RAD)
  const ky = EARTH_RADIUS_M * RAD
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]
}

async function loadJson(name) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
  return r.json()
}

export async function loadKit() {
  const [kit, buildings, graph, zensus, plots] = await Promise.all([
    loadJson('kit.json'),
    loadJson('buildings.geojson'),
    loadJson('streets.graph.json'),
    loadJson('zensus.geojson'),
    loadJson('plots.geojson'),
  ])
  return { kit, buildings, graph, zensus, plots }
}

function bboxOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return [minX, minY, maxX, maxY]
}

// Drop the repeated closing point of a GeoJSON ring.
function openRing(ring) {
  const a = ring[0], b = ring[ring.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring
}

// Every building as rings in metres, with its height and main use.
export function prepareBuildings(geojson, project) {
  return geojson.features.map((f) => {
    const rings = f.geometry.coordinates.map((ring) => openRing(ring).map(project))
    return {
      id: f.properties.id,
      height: f.properties.height,
      use: f.properties.use ?? 'undefined',
      floors: f.properties.floors,
      floorArea: Object.values(f.properties.floor_area_m2 ?? {}).reduce((s, v) => s + v, 0),
      rings,
      bbox: bboxOf(rings),
    }
  })
}

// Every plot as rings in metres, with its land use.
export function preparePlots(geojson, project) {
  return geojson.features.map((f) => {
    const rings = f.geometry.coordinates.map((ring) => openRing(ring).map(project))
    return { landuse: f.properties.landuse, rings, bbox: bboxOf(rings) }
  })
}

// Every census cell as a ring in metres, with its population (null = no figure).
export function prepareCells(geojson, project) {
  return geojson.features.map((f) => {
    const ring = openRing(f.geometry.coordinates[0]).map(project)
    return {
      id: f.properties.id,
      population: f.properties.population,
      heating: f.properties.heating_main,
      ring,
      bbox: bboxOf([ring]),
    }
  })
}
