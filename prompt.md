Build a web app that shows how far you can walk from any point in the city kit, and who lives there.

**Data.** Use only the files in `public/data/`. Read `SOURCES.md` there first, then look inside `buildings.geojson`, `streets.graph.json` and `zensus.geojson` to learn their exact field names. Fetch nothing from the internet. Before you build, tell me in a few lines what each file contains and in which units.

**The city.** A 3D view of the whole kit area. Buildings extruded from their footprints to their `height` in metres, on a pale ground, with the street network drawn thin. Colour each building by its main `use` in a quiet palette, with a legend that names each colour. Orbit, pan and zoom with the mouse.

**The reach.** When I click on the ground, start at the nearest walkable node of `streets.graph.json`. If no walkable street is within 100 m, say so instead. Walk along the graph's walkable edges, using their `length` in metres, at 4.8 km/h, which is 80 m per minute. Show three nested areas for 5, 10 and 15 minutes, in three shades of one accent colour. Each area is the street segments reached in that time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. Not a circle and not a convex hull. Highlight the buildings that touch each area in the matching shade.

**The residents.** For each of the three areas, count the residents from the 100 m cells in `zensus.geojson`. For every cell that overlaps the area, take its population times the share of the cell's area that lies inside. Add these up and round to the nearest 10. Some cells may have no published figure: their `population` is `null`. These cells aren't zero. Leave them out of the sum, and show next to it how many such cells overlap the area.

**On screen.** A small panel with, for each of 5, 10 and 15 minutes, the number of buildings reached and about how many residents live there. Below it, in plain words: the walking speed, the 25 m band, how residents are counted and that cells without a figure are left out. On the map, one attribution line naming every source with its licence, worded as in `SOURCES.md`.

**Stack and hosting.** Follow `CLAUDE.md`. The repo holds a bare Vite and React app whose start page is `src/App.jsx`; replace the start page with this app. Use React Three Fiber for the 3D. Merge the buildings into few meshes so orbiting stays smooth. It has to work on localhost and on GitHub Pages at `https://<user>.github.io/<repo>/`.

**README.** Write `README.md`: what the app does, how to run it, the method and its limits as listed under "On screen", and the data sources. End it with a section "How this was made" with four lines:

1. Tools: Claude Code, and the model you are.
2. I decided: leave this line empty. I write it.
3. The agent did: what you did, in one sentence.
4. I checked: leave this line empty. I write it.

Don't commit or push. I'll check the app first and do it myself. When you're done, tell me how to start the app and what I should check on the page.
Turn this view of a 3D massing model into a photorealistic architectural photograph of the same scene.

Keep the camera, the perspective and every building exactly as they are. Do not add, remove, move or reshape anything.

What the colours in the model are:
- [colour]: [material], for example orange: red brick facade
- [colour]: [material]
- [colour]: [material]
- [any stand-in shape]: [what it really is]

Light: [time of day, weather, season].

A few people for scale. Vertical lines stay vertical.

## Rhino and Grasshopper

You work in Rhino and Grasshopper through the Rhino MCP.

- Rhino and my app share coordinates. Before you bring data into Rhino, read how my app turns longitude and latitude into metres, and use the same conversion and origin.
- Write Grasshopper logic in Python 3 Script components, as plain scripts whose outputs are variables, not as classes. Give every input a type hint (Curve, Point3d, float, int).
- Read geometry I draw in Rhino through a Geometry Pipeline, filtered by layer and by type.
- One job per script. Split a large script into separate components that pass geometry to each other, for example buildings, trees and details.
- Show results as Grasshopper previews, with a Custom Preview and a colour swatch per output. Don't bake unless I ask.
- Closed solids face outwards, with their faces split at the corners.
- Details sit a few centimetres in front of the surface they belong to, and flat surfaces a few centimetres above the one below, so nothing flickers.
- If a call to Rhino or Grasshopper hangs, stop and tell me: a dialog is probably open. Don't retry.
- To put the design in my app: export what Grasshopper shows, in its colours, as one `.glb` file in `public/data/`, in the app's coordinates, and load it in the app's 3D scene. Rhino's glTF export keeps only render materials and drops transparency, so give each colour a render material and restore transparency in the app.

## Keys

- Keys live in `.env` and nowhere else: not in code, not in a commit, never in a variable starting with `VITE_`.
- Anything that needs a key runs as a Node script on my laptop, not in the page.
