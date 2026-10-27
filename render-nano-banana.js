// Turns a Rhino viewport capture into a photorealistic render with Google's Nano Banana 2.1,
// through Replicate (google/nano-banana-2.1). Runs on this laptop only, because it needs the key in .env:
//   REPLICATE_API_TOKEN=...
// Usage:
//   node render-nano-banana.js <capture.png> <render.png> ["extra instructions"]
import fs from 'node:fs'
import path from 'node:path'

const MODEL = 'google/nano-banana-2.1'
const API = 'https://api.replicate.com/v1'

const PROMPT = `Turn this architectural model view into a photorealistic architectural visualisation photo.
Keep the camera, perspective, building shapes, number of floors, balconies, arches, window positions,
street layout, people, tree and lamp exactly where they are. Do not add or remove buildings or floors.
Materials: warm beige natural stone cladding in staggered courses, white stone ledges and band,
clear glass balcony railings, large glass shopfronts with warm interior light and shop displays
behind the stone arches on the ground floor, cobblestone and stone paving, lush green tree.
The plain blue blocks are existing historic buildings of central Weimar, Germany: render them as
plastered old-town facades with pitched tiled roofs. The grey background is sky: make it a soft late
afternoon sky with warm sunlight and long soft shadows. Natural colours, high detail, 35 mm photo.`

// Read the key from .env without printing it.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '.env'))
} catch {
  // no .env: fall through to the check below
}
const token = process.env.REPLICATE_API_TOKEN
if (!token) {
  console.error('No REPLICATE_API_TOKEN in .env. Add a line REPLICATE_API_TOKEN=<your token> to .env and run again.')
  process.exit(1)
}
const auth = { Authorization: `Bearer ${token}` }

const [input, output, extra] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: node render-nano-banana.js <capture.png> <render.png> ["extra instructions"]')
  process.exit(1)
}

async function check(res, what) {
  if (res.ok) return res.json()
  console.error(`${what} failed: ${res.status} ${res.statusText}`)
  console.error(await res.text())
  process.exit(1)
}

// 1. Upload the capture, so the model can read it.
const form = new FormData()
form.append('content', new Blob([fs.readFileSync(input)], { type: 'image/png' }), path.basename(input))
const file = await check(await fetch(`${API}/files`, { method: 'POST', headers: auth, body: form }), 'Upload')

// 2. Start the render and wait for it.
let prediction = await check(await fetch(`${API}/models/${MODEL}/predictions`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'wait=60' },
  body: JSON.stringify({
    input: {
      prompt: extra ? `${PROMPT}\n${extra}` : PROMPT,
      image_input: [file.urls.get],
      aspect_ratio: '16:9',
      resolution: '2K',
      output_format: 'png',
    },
  }),
}), 'Render')
console.log(`Rendering with ${MODEL} ...`)
while (['starting', 'processing'].includes(prediction.status)) {
  await new Promise((r) => setTimeout(r, 3000))
  prediction = await check(await fetch(prediction.urls.get, { headers: auth }), 'Status check')
}
if (prediction.status !== 'succeeded') {
  console.error(`Render ${prediction.status}: ${prediction.error ?? ''}`)
  process.exit(1)
}

// 3. Download the result.
const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
const img = await fetch(url)
if (!img.ok) {
  console.error(`Download failed: ${img.status}`)
  process.exit(1)
}
fs.writeFileSync(output, Buffer.from(await img.arrayBuffer()))
console.log(`Saved ${output} (${prediction.metrics?.predict_time?.toFixed(0) ?? '?'} s)`)
