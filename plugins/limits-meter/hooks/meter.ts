export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Level = 0 | 90 | 95

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'wk', spend_limit: 'spend' }
const label = (kind: string) => LABEL[kind] ?? kind
const pct = (n: number) => `${Math.round(n)}%`

export const statusText = (limits: Limit[], running: number): string | undefined => {
  const parts = limits.map(l => `${label(l.kind)} ${pct(l.percentUsed)}`)
  if (running > 0) parts.push(`${running} agent${running === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

const levelOf = (percent: number): Level => (percent >= 95 ? 95 : percent >= 90 ? 90 : 0)

// What a window has been announced at, and the level to announce now if it rose.
// The memory clears once the window falls under 85%, so a reset window can warn again.
export const step = (seen: Level, percent: number): { seen: Level; announce?: 90 | 95 } => {
  const now = levelOf(percent)
  if (now > seen) return { seen: now, announce: now as 90 | 95 }
  return { seen: percent < 85 ? 0 : seen }
}

const resetsIn = (resetsAt: string | undefined, now: number): string => {
  const ms = resetsAt === undefined ? NaN : Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  return h > 0 ? ` Resets in ${h}h ${minutes % 60}m.` : ` Resets in ${minutes}m.`
}

export const warning = (limit: Limit, level: 90 | 95, now: number): string =>
  `${label(limit.kind)} window at ${pct(limit.percentUsed)}. ` +
  (level === 95 ? 'Stop launching new work.' : 'Finish the current wave; start no more.') +
  resetsIn(limit.resetsAt, now)
