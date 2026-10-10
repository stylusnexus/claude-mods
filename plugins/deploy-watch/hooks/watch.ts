export type Deploy = { id: string; status: string; message?: string }
export type Service = { id: string; name: string }
export type Reading = { service: Service; deploy?: Deploy; problem?: 'auth' | 'error'; detail?: string }

const BUILDING = ['created', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress']
const FAILED = ['build_failed', 'update_failed', 'pre_deploy_failed']

export const light = (status: string): string =>
  status === 'live' ? '🟢' : BUILDING.includes(status) ? '🟡' : FAILED.includes(status) ? '🔴' : '⚪'

// "srv-abc" or "api=srv-abc", separated by commas or spaces.
export const parseServices = (text: string): Service[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(item => {
      const [name, id] = item.includes('=') ? item.split('=') : [item, item]
      return { id: id!, name: name! }
    })

// The newest deploy from Render's list-deploys body, wrapped as { deploy } or flat.
export const parseDeploy = (body: unknown): Deploy | undefined => {
  const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined
  const d = (first?.deploy ?? first) as { id?: unknown; status?: unknown; commit?: { message?: unknown } } | undefined
  if (typeof d?.id !== 'string' || typeof d.status !== 'string') return undefined
  const message = typeof d.commit?.message === 'string' ? d.commit.message.split('\n')[0]!.slice(0, 40) : undefined
  return { id: d.id, status: d.status, message }
}

export const statusLine = (readings: Reading[]): string => {
  const details = new Set(readings.map(r => (r.problem ? r.detail ?? '' : undefined)))
  if (details.size === 1 && [...details][0]) return `deploy: ❔ ${[...details][0]}`
  return (
    'deploy: ' +
    readings
      .map(r => `${r.service.name} ${r.problem ? `❔${r.detail ? ` ${r.detail}` : ''}` : r.deploy ? light(r.deploy.status) : '⚪'}`)
      .join(' · ')
  )
}

// What to tell the person when a service's newest deploy moved; nothing on the first reading.
export const transition = (name: string, prev: Deploy | undefined, next: Deploy): string | undefined => {
  if (prev === undefined) return undefined
  const what = next.message ? ` (${next.message})` : ''
  const l = light(next.status)
  if (next.id !== prev.id) {
    if (l === '🟡') return `${name} deploy started${what}`
    if (l === '🟢') return `${name} deploy is live${what}`
    if (l === '🔴') return `${name} deploy failed${what}`
    return undefined
  }
  if (next.status === prev.status) return undefined
  if (l === '🟢') return `${name} deploy is live${what}`
  if (l === '🔴') return `${name} deploy failed${what}`
  if (next.status === 'canceled') return `${name} deploy was canceled${what}`
  return undefined
}
