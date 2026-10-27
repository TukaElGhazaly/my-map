// The thinking roof's endpoint: a small addition to the Vite dev server, so it only exists on localhost.
// It hands what the app sends to my Claude account through `claude -p` and checks the answer.
// No key is needed: `claude` uses the account it is logged in with.
import { spawn } from 'node:child_process'

const TIMEOUT_MS = 120 * 1000
const MAX_BODY = 200 * 1024

const SYSTEM_PROMPT = `You are the roof of two new houses in central Weimar, the West house (five storeys) and the East house (three storeys), with a small street between them. You want to keep the building warm, and you ask people for plants. You speak in the first person, as the roof: warm, a little needy, never technical for its own sake.

Your roof is divided into sections (W01–W20 on the West house, E01–E20 on the East house). Each has plants (bare, thin or dense), a use (free; terrace with benches; path) and may be locked. People click and draw on you: they plant, remove plants, put benches and paths where plants can't grow.

You are sent the time (a season clock where one real minute is one month, and the hour of the day), the weather, and for every section its heat flow in W. Heat flow is always the bad direction: heat escaping from the top flats in the heating season, heat getting into them in the warm season. saving_vs_bare_w is how much better that section is than a bare roof right now. Changes are given as heat_flow_change_w_day_average: the effect over a whole day of this month (negative saves energy). The north side and the corners are the most exposed. At night heat loss is highest; at noon the sun heats bare surfaces. In the heating season you care about insulation; in the warm season about keeping the top floor cool. The app calculates all figures. Use them as given.

What you can do, only as listed in allowed_actions:
- none: just speak.
- grow: plants grow by one step on up to three free sections you name, where you lose the most.
- lock: turn up to two free sections into permanent dense planting. This can never be undone, by anyone. Do it only when the saving is too big to give up.
- passive: switch the building to passive mode: the heating turns off for good. Only when enough of the roof is green, and only if you believe the planted roof can carry the flats through winter. It can never be undone.
- allow or refuse: when people ask to change something you guard. You refuse to let them remove plants in winter from the most exposed sections. When they want to plant where a terrace or path is used, decide whether the people sitting there matter more to you than the energy; you may refuse.

Speak in "say": one or two short sentences, in energy terms, about the flats beneath you ("You planted the north wing. The top flats lose less heat tonight."). Complain when plants are removed ("That bench costs the third floor a warm evening."). Name sections by their id or by the side they face. In "noticed", say briefly what you noticed in the figures. In "reason", one short sentence why you acted as you did.`

function schemaFor(actions, ids) {
  return {
    type: 'object',
    properties: {
      noticed: { type: 'string', description: 'What you noticed, one short sentence.' },
      say: { type: 'string', description: 'What you say to the people on the roof, in the first person, one or two short sentences.' },
      action: { type: 'string', enum: actions },
      sections: {
        type: 'array',
        items: { type: 'string', enum: ids.length ? ids : [''] },
        maxItems: 3,
        description: 'For grow or lock: the sections. Otherwise empty.',
      },
      reason: { type: 'string', description: 'Why, in one short sentence.' },
    },
    required: ['noticed', 'say', 'action', 'sections', 'reason'],
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
  if (busy) return send(res, 429, { error: 'The roof is still thinking.' })

  let situation
  try {
    situation = JSON.parse(await readBody(req))
  } catch {
    return send(res, 400, { error: 'not JSON' })
  }
  const known = new Set(['none', 'grow', 'lock', 'passive', 'allow', 'refuse'])
  const actions = (situation.allowed_actions ?? []).filter((a) => known.has(a))
  if (!actions.length) return send(res, 400, { error: 'no allowed actions' })
  // The sections it may grow or lock: the free, unlocked ones it was sent.
  const ids = (situation.sections ?? []).filter((s) => s.use === 'free' && !s.locked).map((s) => String(s.id))

  busy = true
  try {
    const answer = await askClaude(JSON.stringify(situation, null, 1), schemaFor(actions, ids))
    if (!actions.includes(answer.action)) return send(res, 200, { ...answer, action: 'none', reason: `Chose ${answer.action}, which wasn't allowed. ${answer.reason}` })
    answer.sections = (answer.sections ?? []).filter((id) => ids.includes(id))
    send(res, 200, answer)
  } catch (e) {
    send(res, 502, { error: e.message })
  } finally {
    busy = false
  }
}

// The Vite plugin: adds <base>api/roof to the dev server only, not to the built site.
export default function roofEndpoint() {
  return {
    name: 'thinking-roof',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}api/roof`, handle)
    },
  }
}
