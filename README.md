# City reach

How far can you walk from any point in central Weimar, and who lives there?

The app shows the city kit in 3D: the area from the Bauhaus main building in the south to Weimar station in the north, every building extruded to its measured height, on a pale ground with the pedestrian network drawn thin. A switch at the top of the panel chooses between the views.

**Walking reach.** Buildings are coloured by their main use. Click on the ground and it walks from the nearest street node for 5, 10 and 15 minutes. It shows the three areas you reach in three shades of orange, highlights the buildings that touch each area in the matching shade, and counts the buildings and the residents in each area.

**Energy.** Where does the heat go? Buildings are coloured by their estimated heat demand per m² (in the classes of the German energy certificate), by their compactness, or by how much of their wall they share with heated neighbours. Click a building, or choose the Bauhaus main building or the whole area, to see its energy balance over a heating season as a flow diagram: heating, people and appliances, and sun through windows flow in; walls, windows, roof, ground floor and fresh air carry the heat out. A second switch sets the insulation standard: unrenovated, partly renovated or new build.

**Heat.** Where does the city get hot on a summer afternoon, and where does greenery cool it? A model on a grid of 4 m squares, along the transect from the Bauhaus main building to the station (the black line, with a profile chart in the panel). Layers: surface temperature, evaporative cooling (latent heat flux in W/m²), albedo, sky view factor, night-time heat retention, mean radiant temperature (Tmrt), and hotspots with cooling buffers. A switch sets the time: 11:00, 15:00 or 18:00. Click any spot to see its energy balance.

**Topology.** How is the city connected, rather than how far apart are things? Layers: street integration and choice (space syntax angular segment analysis, for the whole network or within 800 m), junctions by the number of ways that meet, buildings joined by party walls, blocks and enclosed courtyards, networks of green and blue spaces (joined across gaps of 10 to 100 m), and street canyons (wall height ÷ street width). A table compares the corridor 200 m on each side of the transect with the whole kit. Click a street, a building or the ground for details.

**Thinking roof.** My design for the plot west of the Markt, two houses with a street between them, from Rhino and Grasshopper (`public/data/design.glb`). Its two roofs are divided into 40 sections (`public/data/roof.json`). The roof thinks: it wants to keep the building warm and asks you for plants. Plant, remove plants, put benches, or draw a planting area or a path on the roof. A season clock runs (one real minute is one month, a day passes in 24 seconds). The roof comments on your changes, reconsiders when the season turns, checks once a minute where it loses most, and acts by itself when the heat flow passes a limit. It grows plants, refuses some of your changes, and can decide two things that can't be undone: plant a section for good, and switch the building to passive mode, with the heating off for good. A heat overlay shows where heat escapes (red) and where it's held in (blue); windows glow warm or cold, and a bar above each house shows its top floor's heating.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag with the left mouse button to orbit, with the right button to pan, and scroll to zoom. A click without dragging starts a walk; a click on a building starts below the clicked spot.

`npm run build` makes the published version in `dist/`. GitHub Pages builds and publishes it on every push to `main`, at `https://<user>.github.io/<repo>/`.

## Method and its limits: walking reach

- **Start.** The walk starts at the street node nearest to the click. If no walkable street node is within 100 m, the app says so and draws nothing.
- **Walking speed.** 4.8 km/h, which is 80 m per minute, along the walkable edges of the pedestrian network, using each edge's `length` in metres. The shortest walking distance to every node comes from Dijkstra's algorithm. The same speed holds everywhere: no slopes, stairs, crossings or waiting at traffic lights.
- **The 25 m band.** Each area is the street segments reached in that time, including the reachable part of the last segment, with a band of 25 m on each side (round at the ends), joined into one shape. It is not a circle and not a convex hull. A building counts when its footprint touches the area. Each longer walk includes the shorter ones, so the 10-minute figures include the 5-minute ones.
- **Residents.** From the Zensus 2022 grid of 100 m cells. For every cell that overlaps the area, the app takes the cell's population times the share of the cell's area that lies inside, adds these up and rounds to the nearest 10. This assumes that people are spread evenly over each cell, which they aren't: a cell half covered by the band may have all its flats outside it. The census also changes small counts slightly at random to protect privacy, so the figures are approximate.
- **Cells without a figure.** Some cells have no published resident count (`population` is `null`). They are not zero. They are left out of the sum, and the panel shows how many such cells overlap each area, so the true number may be higher.
- **Edges of the kit.** The network stops at the edge of the kit, so walks near the edge are cut short, and residents just outside the kit are not counted.

## Method and its limits: energy

Two principles of thermodynamics carry the whole calculation:

- **Heat flows from warm to cold.** Through each surface it flows at U-value × area × temperature difference. A wall shared with a heated neighbour has almost no temperature difference across it, so it loses almost nothing. That is why compact blocks need less heat than detached houses.
- **Energy is conserved.** Over a heating season, the heat that comes in (heating, people and appliances, sun through windows) equals the heat that goes out (walls, windows, roof, ground floor, fresh air). Heating makes up whatever the free gains don't cover.

**Measured from the kit.** Footprints, heights and floor areas. For every wall: whether it touches the wall of a heated neighbour (within 0.5 m), up to the neighbour's height, and which way its outside faces. From these: the outside wall area, roof and ground floor area, volume, compactness (outside surface ÷ volume) and the share of shared wall.

**Assumed, not in the kit.**

| Value | Assumed |
| --- | --- |
| U-values, W/m²K (walls / windows / roof / ground) | unrenovated 1.4 / 2.8 / 1.0 / 1.0; partly renovated 0.8 / 1.6 / 0.4 / 0.8; new build (GEG reference) 0.28 / 1.3 / 0.2 / 0.35 |
| Windows | 30% of each outside wall |
| Climate | one W/K of heat loss costs 66 kWh per heating season (German reference climate, heating-period method of DIN V 4108-6) |
| Ground floor | losses × 0.6, because the ground is warmer than the outside air |
| Fresh air | 0.6 times the room air per hour; room air is 80% of the gross volume |
| People and appliances | 22 kWh per m² floor area and season |
| Sun | on walls from 100 kWh/m² facing north to 270 facing south over the season; glass lets 60% through; frames and shading take 37% |
| Use of gains | 95% of the free gains replace heating |
| Unheated | buildings under 3 m are taken as sheds, garages and carports |

**Limits.** The kit has no construction year or insulation, so every building gets the same standard. Roofs are taken as flat at the building's highest point, so the volume is too high for pitched roofs. Every use is heated like housing. Neighbours don't shade each other. Losses of the heating system itself are not included. Floor areas are estimates. Read the figures as a comparison between building forms and insulation standards, not as the real consumption of any building. The census heating type shown for a building is the most common one in its 100 m cell, not necessarily that building's.

## Method and its limits: heat

**Everything in this view is a model, not a measurement.** The city kit has no satellite surface temperatures, no trees and no materials, so the view compares places under the same assumed conditions.

- **The grid.** The kit is laid out in squares of 4 m. Each square is a roof (under a building), a plot with its land use, or street space (the ground between plots, up to 25 m from a street or path). Ground outside every plot and further from a path, near the edge of the kit, has no data: it is shown in grey and left out.
- **Sky view factor (measured).** From every square on the ground, the app looks in 16 directions up to 100 m and finds the steepest building edge. The share of the sky that stays visible is the sky view factor: 1 in an open field, near 0 in a narrow courtyard.
- **Shadows (measured).** For the sun's position on 21 July at 11:00, 15:00 and 18:00 (summer time), every square is in the sun or in the shadow of a building.
- **Surface energy balance.** Each square absorbs sunlight (less where its albedo is high) and longwave heat from the sky and the walls around, and radiates heat itself. What is left goes three ways: sensible heat warms the air, latent heat evaporates water from leaves and soil, and the rest goes into the ground. Solving this balance gives the surface temperature. Sealed surfaces can't evaporate, so they turn the sun into heat in the air; greenery and moist soil turn a large share into evaporation and stay cooler.
- **Night-time heat retention.** Oke's (1981) relation between sky view factor and the urban heat island, ΔT = 15.27 − 13.88 × SVF: narrow streets can't radiate their heat to the night sky. It uses geometry only, not materials.
- **Mean radiant temperature (Tmrt).** The heat a standing person absorbs from direct and diffuse sun, sunlight reflected by the ground and walls, and longwave heat from sky, walls, tree crowns and ground.
- **Hotspots and cooling buffers.** Hotspots are the hottest 10% of streets, squares and parks by Tmrt. Cooling buffers are green places (at least half trees or grass) where Tmrt is at least 10 K below open, sunlit street at the same time.

**Assumed, not in the kit.**

| Value | Assumed |
| --- | --- |
| Weather | clear sky on 21 July; air at 27 °C (11:00), 30 °C (15:00), 28 °C (18:00); sky emissivity 0.8 |
| Sunlight | clear-sky direct and diffuse light from the sun's height |
| Surfaces of each land use | street space: 75% asphalt, 20% paving, 5% trees; squares: 85% paving, 10% trees, 5% grass; residential yards: 35% paving, 35% grass, 20% trees, 10% soil; parks: 45% trees, 40% grass, 10% paths, 5% soil; and so on (click a square to see its mix, all in `src/heat.js`) |
| Materials (albedo / share into evaporation) | asphalt 0.10 / 0; paving 0.30 / 0.03; roof 0.15 / 0; bare soil 0.20 / 0.2; grass 0.22 / 0.55; tree canopy 0.16 / 0.7; water 0.07, kept at 24 °C |
| Walls | 6 K warmer than the air, reflect 30% of the sun |

**Limits.** The kit has no trees, so greenery is a share per land use, not real tree crowns, and street trees are missing. There are no satellite temperatures to check the model against. It is a steady state, so heat stored since the morning is not included. One air temperature everywhere, and no wind field. Tmrt is not a full comfort index: UTCI or PET would also need wind and humidity. The night layer ignores materials and greenery. Use the view to compare places and to see which surface and which geometry makes the difference, not as a measurement.

## Method and its limits: topology

Everything in this view is measured from the kit; only the thresholds below are chosen.

- **Street network.** The pedestrian network is a graph of junctions and segments. *Degree* is how many ways meet at a junction (1 is a dead end, 2 only a bend). For space syntax, every segment becomes a node of its own, linked to the segments it meets; a turn of 90° costs one step, going straight costs nothing. *Integration* is high where all other segments can be reached with little turning; *choice* is high where many of the simplest routes between other segments pass through. Both are normalised after Hillier, Yang and Turner (2012), for the whole network and within 800 m walking, and coloured by tenths.
- **Party walls.** Two buildings share a wall where their walls run parallel within 0.5 m of each other for at least 1 m. Buildings joined this way form groups (terraces, perimeter blocks). Each facade is also sorted by what lies 2 m in front of it: street, open yard, enclosed courtyard, or a neighbour.
- **Blocks and courtyards.** On a 4 m grid, the ground between plots is street space. A block is all the land between streets. Open ground in a block that can't be reached from the street without passing through a building is an *enclosed courtyard*. *Block edges built up* is the share of a block's street edge that is building: high means a closed street wall, low means a permeable block.
- **Green and blue networks.** Parks, the cemetery, wasteland and water are patches. Two patches belong to one network when the gap between them is at most the chosen distance (10, 30, 60 or 100 m). The largest network and the isolated patches show where green is continuous and where it is fragmented.
- **Street canyons.** Every 4 m along each segment, the app looks up to 40 m to each side for the first wall and its height. *Height ÷ width* uses the places with walls on both sides; *edges lined by walls* is the share of sides with a wall within 25 m.
- **The corridor** is everything within 200 m of the straight line from the Bauhaus main building to the station.

**Limits.** The kit ends at its edge, so streets near the edge look less integrated than they are. The network is drawn for walking (with crossings over squares), not a classic axial map, so values are not directly comparable with published space syntax studies. The kit has no trees or tree lines, so green networks miss private gardens and street trees. A courtyard reached through a gateway in a building counts as enclosed. Heights are to the highest point of the roof, so canyons with pitched roofs look a little deeper than they are.

## Method and its limits: thinking roof

- **Heat flow through a roof section** = U-value × area × (20 °C inside − roof surface temperature). The insulated roof has U = 0.25 W/m²K; thin planting adds 0.4 m²K/W, dense planting 1.2. The surface is the air temperature, plus the sun it takes in (bare 85%, thin 35%, dense 15%, at 20 W/m²K to the air), minus night-sky cooling (bare 4 K, thin 2 K, dense 0.5 K). North-facing sections lose 25% more, corners 20% more, south-facing 10% less.
- **Season.** While the month's mean temperature is below 12 °C (October to April), heat leaving the flats counts. Otherwise heat getting in counts, once the surface is above 25 °C. Climate: rounded monthly means, day-night swing, noon sunshine and day length for Weimar.
- **Top floor.** Roof plus facade (1.6 W/K per metre of facade, 3 m high) minus 4 W/m² from people and appliances.
- **Time.** One real minute is one month, starting this month; a day passes in 24 seconds, as a sample of the month. Energy saved is counted against a bare roof at the month's pace. The effect of a change is its average over a whole day of that month.
- **The roof** is a language model (Claude Haiku, through `claude -p` on my laptop, from `roof-server.js`; only with `npm run dev`). It gets the clock, the weather and every section's figures and decides; the app checks that it only grows or locks free sections, and only switches to passive mode once 60% of the roof is green. It is asked first when you remove plants from the north side or a corner in winter, or plant over benches or a path.

**Limits.** Rounded climate, no snow, rain or wind speed, a steady 20 °C inside, no heat stored in the building. The roof sections follow my Grasshopper definition on 27 October 2026; a change there needs a new export. Read the figures as a comparison between roofs, not as a prediction.

## Data sources

All data comes from `public/data/`; the app fetches nothing from the internet. See `public/data/SOURCES.md`.

| Data | Source | Licence |
| --- | --- | --- |
| Building footprints and heights | 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| Land use per plot | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Pedestrian network | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Census grid | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |
| My design and its roof sections (`design.glb`, `roof.json`) | exported from my Rhino and Grasshopper model | |

Attribution, as shown on the map:

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, wrote the 3D view, the walking, band and resident calculations, the energy balance and flow diagram, the surface heat model, the topology analysis, the thinking roof (export from Grasshopper, heat model, endpoint), the panels and this README, and tested them.
4. I checked:
