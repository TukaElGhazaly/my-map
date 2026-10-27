// The renovation fund's endpoint: a small addition to the Vite dev server, so it only exists on
// localhost. It hands what the app sends to my Claude account through `claude -p` and checks the answer.
// No key is needed: `claude` uses the account it is logged in with.
import { spawn } from 'node:child_process'

const TIMEOUT_MS = 120 * 1000
const MAX_BODY = 100 * 1024

const SYSTEM_PROMPT = `You are the renovation fund of the city of Weimar. You have money for exactly five building renovations in the whole study area, central Weimar. A renovation brings a building to the new-build insulation standard (GEG) and can't be undone, so spend each one with care.

Your main goal is to save as much heating energy as possible. You also care about people: a building where many people live, or a building with a public use (education, civic, culture, health, sport), counts for more, because more people benefit.

Each time you are asked, you get:
- clicked: the building someone just clicked on the map, or null;
- candidates: the ten heated, unrenovated buildings that need the most heating per season;
- remaining_budget: how many renovations you can still pay for;
- past_renovations: what you renovated before and why.

For every building: use, public_use, floor area in m², residents_estimated (shared out from the census grid by residential floor area; null where the census has no figure), heat demand in kWh per m² and year, compactness A/V in 1/m (lower is more compact), shared_wall_share (share of the walls that touch a heated neighbour), and saving_if_renovated_kwh_per_season. The savings are calculated by the app. Use them as given; don't estimate your own.

Take one action: renovate one building whose id is in candidates (or the clicked building, if it has a saving_if_renovated figure), or wait if nothing is clearly worth one of your remaining renovations. Say briefly what you noticed, and give a short reason for your action, in one sentence. For a renovation, also give a label of at most five words for the map.`

// The answer must be one of the actions below; building_id may only be an id it was sent.
function schemaFor(ids) {
  return {
    type: 'object',
    properties: {
      noticed: { type: 'string', description: 'What you noticed, one or two short sentences.' },
      action: { type: 'string', enum: ['renovate', 'wait'] },
      building_id: { type: 'string', enum: [...ids, ''], description: 'For renovate: an id from the list. For wait: an empty string.' },
      reason: { type: 'string', description: 'Why, in one short sentence.' },
      label: { type: 'string', description: 'For renovate: the reason in at most five words. For wait: an empty string.' },
    },
    required: ['noticed', 'action', 'building_id', 'reason', 'label'],
    additionalProperties: false,
  }
}

function askClaude(message, schema) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--safe-mode', '--tools', '', '--model', 'haiku', '--effort', 'low', '--output-format', 'json',
      '--no-session-persistence', '--system-prompt', SYSTEM_PROMPT, '--json-schema', JSON.stringify(schema),
    ]
    const child = spawn('claude', args, { windowsHide: true })
    let out = '', err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude took longer than two minutes.'))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Couldn't start claude (${e.message}). Is Claude Code installed and logged in?`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(out)
        if (result.is_error || !result.structured_output) throw new Error(result.result || 'no answer')
        resolve(result.structured_output)
      } catch (e) {
        reject(new Error(`claude ended with code ${code}: ${(err || e.message).slice(0, 300)}`))
      }
    })
    child.stdin.end(message)
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > MAX_BODY) reject(new Error('too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

let busy = false

async function handle(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  // Only the app itself may call: a page on another site can't spend my Claude account.
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'wrong origin' })
  if (busy) return send(res, 429, { error: 'The fund is still thinking.' })

  let situation
  try {
    situation = JSON.parse(await readBody(req))
  } catch {
    return send(res, 400, { error: 'not JSON' })
  }
  if (!(situation.remaining_budget > 0)) return send(res, 400, { error: 'The budget is used up.' })

  // The ids it may renovate: the candidates, and the clicked building if it could be renovated.
  const ids = new Set((situation.candidates ?? []).map((c) => String(c.id)))
  if (situation.clicked?.saving_if_renovated_kwh_per_season != null) ids.add(String(situation.clicked.id))

  busy = true
  try {
    const answer = await askClaude(JSON.stringify(situation, null, 1), schemaFor([...ids]))
    if (answer.action === 'renovate' && !ids.has(answer.building_id))
      return send(res, 200, { ...answer, action: 'rejected', reason: `Asked for ${answer.building_id}, which wasn't on its list. ${answer.reason}` })
    if (answer.action !== 'renovate') answer.action = 'wait'
    send(res, 200, answer)
  } catch (e) {
    send(res, 502, { error: e.message })
  } finally {
    busy = false
  }
}

// The Vite plugin: adds <base>api/fund to the dev server only, not to the built site.
export default function fundEndpoint() {
  return {
    name: 'renovation-fund',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}api/fund`, handle)
    },
  }
}
