import type { EngineInterface, Register } from 'claude-code'
import { statusText, step, warning, type Level } from './meter'

async function paint($: EngineInterface) {
  const [{ rateLimits }, agents] = await Promise.all([$.session.usage(), $.agent.list()])
  $.ui.status(statusText(rateLimits, agents.filter(a => a.status === 'running').length))
}

export const register: Register = on => {
  const seen: Record<string, Level> = {}

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await paint($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    for (const limit of e.rateLimits) {
      const { seen: level, announce } = step(seen[limit.kind] ?? 0, limit.percentUsed)
      seen[limit.kind] = level
      if (announce) $.ui.toast(`${$.plugin.name}: ${warning(limit, announce, now)}`)
    }
    await paint($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await paint($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) await paint($)
    return result
  })
}
