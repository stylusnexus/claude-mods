import type { EngineInterface, Register } from 'claude-code'
import { parseDeploy, parseServices, statusLine, transition, type Deploy, type Reading, type Service } from './watch'

export type Watched = { seen: Map<string, Deploy>; isAuthReported: boolean }

async function read($: EngineInterface, key: string, service: Service): Promise<Reading> {
  const url = `https://api.render.com/v1/services/${encodeURIComponent(service.id)}/deploys?limit=1`
  let fetched: { ok: boolean; status: number; text: string }
  try {
    fetched = await $.http.fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
  } catch (err) {
    return { service, problem: 'error', detail: `no reply (${String(err instanceof Error ? err.message : err).slice(0, 40)})` }
  }
  if (!fetched.ok) {
    const auth = fetched.status === 401 || fetched.status === 403
    return { service, problem: auth ? 'auth' : 'error', detail: `Render ${fetched.status}` }
  }
  try {
    const body: unknown = JSON.parse(fetched.text)
    if (Array.isArray(body) && body.length === 0) return { service }
    const deploy = parseDeploy(body)
    return deploy ? { service, deploy } : { service, problem: 'error', detail: 'unrecognised reply' }
  } catch {
    return { service, problem: 'error', detail: 'reply is not JSON' }
  }
}

// One round: read each service, say what moved, redraw the status line. Never throws.
export async function poll($: EngineInterface, key: string, services: Service[], watched: Watched) {
  try {
    const readings = await Promise.all(services.map(s => read($, key, s)))
    for (const r of readings) {
      if (r.problem === 'auth' && !watched.isAuthReported) {
        watched.isAuthReported = true
        $.ui.toast(`${$.plugin.name}: Render refused the API key; check renderApiKey.`)
      }
      if (!r.deploy) continue
      const said = transition(r.service.name, watched.seen.get(r.service.id), r.deploy)
      if (said) $.ui.toast(`${$.plugin.name}: ${said}`)
      watched.seen.set(r.service.id, r.deploy)
    }
    $.ui.status(statusLine(readings))
  } catch {
    $.ui.status(undefined)
  }
}

export const register: Register = (on, options) => {
  const key = typeof options.renderApiKey === 'string' ? options.renderApiKey.trim() : ''
  const services = parseServices(typeof options.serviceIds === 'string' ? options.serviceIds : '')
  const periodMs = Math.max(10, Number(options.pollSeconds) || 30) * 1000
  const watched: Watched = { seen: new Map(), isAuthReported: false }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (key === '' || services.length === 0) {
      $.ui.toast(`${$.plugin.name}: set renderApiKey and serviceIds to watch deploys.`)
      return result
    }
    await poll($, key, services, watched)
    $.clock.every(periodMs, () => {
      void poll($, key, services, watched)
    })
    return result
  })
}
