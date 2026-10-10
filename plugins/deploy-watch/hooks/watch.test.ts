import { test, expect } from 'claude-code/testing'
import { light, parseDeploy, parseServices, statusLine, transition } from './watch'
import { poll, register, type Watched } from './register'

test('maps Render deploy states to a light', () => {
  expect(light('live')).toBe('🟢')
  for (const s of ['created', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress']) expect(light(s)).toBe('🟡')
  for (const s of ['build_failed', 'update_failed', 'pre_deploy_failed']) expect(light(s)).toBe('🔴')
  expect(light('canceled')).toBe('⚪')
  expect(light('deactivated')).toBe('⚪')
})

test('reads service ids with optional names', () => {
  expect(parseServices('srv-1, api=srv-2  web=srv-3')).toEqual([
    { id: 'srv-1', name: 'srv-1' },
    { id: 'srv-2', name: 'api' },
    { id: 'srv-3', name: 'web' },
  ])
  expect(parseServices('')).toEqual([])
})

test('reads the newest deploy, wrapped or flat', () => {
  const wrapped = [{ cursor: 'c', deploy: { id: 'dep-1', status: 'live', commit: { message: 'fix: a b\n\nbody' } } }]
  expect(parseDeploy(wrapped)).toEqual({ id: 'dep-1', status: 'live', message: 'fix: a b' })
  expect(parseDeploy([{ id: 'dep-2', status: 'build_failed' }])).toEqual({ id: 'dep-2', status: 'build_failed', message: undefined })
  expect(parseDeploy([])).toBeUndefined()
  expect(parseDeploy({})).toBeUndefined()
  expect(parseDeploy([{ deploy: { id: 1 } }])).toBeUndefined()
})

test('draws one light per service', () => {
  const s = (name: string) => ({ id: name, name })
  expect(
    statusLine([
      { service: s('api'), deploy: { id: 'd', status: 'live' } },
      { service: s('web'), deploy: { id: 'd', status: 'build_in_progress' } },
      { service: s('db'), problem: 'error' },
      { service: s('new') },
    ]),
  ).toBe('deploy: api 🟢 · web 🟡 · db ❔ · new ⚪')
})

test('shows why a read failed', () => {
  const s = (name: string) => ({ id: name, name })
  const bad = (name: string, detail: string) => ({ service: s(name), problem: 'error' as const, detail })
  expect(statusLine([bad('a', 'Render 401'), bad('b', 'Render 401')])).toBe('deploy: ❔ Render 401')
  expect(statusLine([bad('a', 'Render 401'), { service: s('b'), deploy: { id: 'd', status: 'live' } }])).toBe(
    'deploy: a ❔ Render 401 · b 🟢',
  )
  expect(statusLine([bad('a', 'Render 401'), bad('b', 'Render 500')])).toBe('deploy: a ❔ Render 401 · b ❔ Render 500')
})

test('says what moved, and nothing on the first reading', () => {
  const d = (id: string, status: string, message?: string) => ({ id, status, message })
  expect(transition('api', undefined, d('1', 'live'))).toBeUndefined()
  expect(transition('api', d('1', 'live'), d('1', 'live'))).toBeUndefined()
  expect(transition('api', d('1', 'live'), d('2', 'build_in_progress', 'fix: a b'))).toBe('api deploy started (fix: a b)')
  expect(transition('api', d('2', 'build_in_progress'), d('2', 'update_in_progress'))).toBeUndefined()
  expect(transition('api', d('2', 'update_in_progress'), d('2', 'live'))).toBe('api deploy is live')
  expect(transition('api', d('2', 'build_in_progress'), d('2', 'build_failed'))).toBe('api deploy failed')
  expect(transition('api', d('2', 'build_in_progress'), d('2', 'canceled'))).toBe('api deploy was canceled')
  expect(transition('api', d('1', 'live'), d('2', 'live'))).toBe('api deploy is live')
  expect(transition('api', d('1', 'live'), d('2', 'deactivated'))).toBeUndefined()
})

// The engine stubbed: Render answers from `answers`, in order.
const engine = (answers: { status: number; body?: unknown }[]) => {
  const toasts: string[] = []
  const lines: (string | undefined)[] = []
  let call = 0
  const $ = {
    plugin: { name: 'deploy-watch' },
    ui: { toast: (t: string) => toasts.push(t), status: (t: string | undefined) => lines.push(t) },
    http: {
      fetch: async () => {
        const a = answers[Math.min(call++, answers.length - 1)]!
        return { status: a.status, ok: a.status < 400, headers: {}, text: JSON.stringify(a.body ?? []) }
      },
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { $: $ as any, toasts, lines }
}
const dep = (id: string, status: string) => ({ body: [{ deploy: { id, status, commit: { message: 'fix: a b' } } }], status: 200 })

test('polls Render: silent baseline, then a toast per move', async () => {
  const { $, toasts, lines } = engine([dep('1', 'live'), dep('2', 'build_in_progress'), dep('2', 'live')])
  const watched: Watched = { seen: new Map(), isAuthReported: false }
  const services = [{ id: 'srv-1', name: 'api' }]
  await poll($, 'key', services, watched)
  expect(toasts).toEqual([])
  expect(lines.at(-1)).toBe('deploy: api 🟢')
  await poll($, 'key', services, watched)
  expect(toasts).toEqual(['deploy-watch: api deploy started (fix: a b)'])
  expect(lines.at(-1)).toBe('deploy: api 🟡')
  await poll($, 'key', services, watched)
  expect(toasts.at(-1)).toBe('deploy-watch: api deploy is live (fix: a b)')
  expect(lines.at(-1)).toBe('deploy: api 🟢')
})

test('reports a refused key once and keeps going on errors', async () => {
  const { $, toasts, lines } = engine([{ status: 401 }, { status: 401 }, { status: 500 }])
  const watched: Watched = { seen: new Map(), isAuthReported: false }
  const services = [{ id: 'srv-1', name: 'api' }]
  await poll($, 'bad', services, watched)
  await poll($, 'bad', services, watched)
  expect(toasts).toEqual(['deploy-watch: Render refused the API key; check renderApiKey.'])
  await poll($, 'bad', services, watched)
  expect(lines.at(-1)).toBe('deploy: ❔ Render 500')
})

test('asks for setup when nothing is configured, and starts no timer', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let start: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on: any = (event: string, fn: any) => event === 'session.start' && (start = fn)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(on, {} as any)
  const { $, toasts } = engine([])
  let timers = 0
  $.clock = { every: () => timers++ }
  await start($, {}, async () => ({}))
  expect(toasts).toEqual(['deploy-watch: set renderApiKey and serviceIds to watch deploys.'])
  expect(timers).toBe(0)
})

test('starts polling when configured', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let start: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on: any = (event: string, fn: any) => event === 'session.start' && (start = fn)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(on, { renderApiKey: 'k', serviceIds: 'api=srv-1', pollSeconds: 5 } as any)
  const { $, lines } = engine([dep('1', 'live')])
  const periods: number[] = []
  $.clock = { every: (ms: number) => periods.push(ms) }
  await start($, {}, async () => ({}))
  expect(lines.at(-1)).toBe('deploy: api 🟢')
  expect(periods).toEqual([10000])
})

const refuse = (msg: string) => {
  const e = engine([])
  e.$.http.fetch = async () => {
    throw new Error(msg)
  }
  return e
}
const answer = (text: string, status = 200) => {
  const e = engine([])
  e.$.http.fetch = async () => ({ status, ok: status < 400, headers: {}, text })
  return e
}
const one = [{ id: 'srv-1', name: 'api' }]
const fresh = (): Watched => ({ seen: new Map(), isAuthReported: false })

test('names the reason when Render cannot be read', async () => {
  const a = refuse('blocked by policy')
  await poll(a.$, 'k', one, fresh())
  expect(a.lines.at(-1)).toBe('deploy: ❔ no reply (blocked by policy)')
  const b = answer('<html>', 200)
  await poll(b.$, 'k', one, fresh())
  expect(b.lines.at(-1)).toBe('deploy: ❔ reply is not JSON')
  const c = answer(JSON.stringify([{ unexpected: true }]))
  await poll(c.$, 'k', one, fresh())
  expect(c.lines.at(-1)).toBe('deploy: ❔ unrecognised reply')
  const d = answer('[]')
  await poll(d.$, 'k', one, fresh())
  expect(d.lines.at(-1)).toBe('deploy: api ⚪')
  const e = answer('{}', 403)
  await poll(e.$, 'k', one, fresh())
  expect(e.lines.at(-1)).toBe('deploy: ❔ Render 403')
  expect(e.toasts.length).toBe(1)
})
