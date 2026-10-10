import type { Register } from 'claude-code'
import { agentRow, applyOp, createPlan, planRow, RULES, visible, type Agent, type Plan } from './plan'

const TOOL = 'mcp__task-progress__task_progress'
const COLORS: Record<string, string> = { error: 'red', needs_input: 'yellow', done: 'green' }

export const register: Register = (on, options) => {
  const keepMs = Math.max(0, Number(options.doneBarSeconds ?? 30)) * 1000
  const plans = new Map<string, Plan>()
  const agents = new Map<string, Agent>()
  let isHidden = false

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'task_progress',
      description:
        'Create or update a progress plan shown to the person. Create: {id, title, stages:[{name, steps:[{title}]}]}. Update: {id, next:true} | {id, done:[titles], active:title} | {id, failed:title, note} | {id, state:"needs_input"|"running"|"error"|"done", note}.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          stages: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
              required: ['name', 'steps'],
            },
          },
          next: { type: 'boolean' },
          done: { type: 'array', items: { type: 'string' } },
          active: { type: 'string' },
          failed: { type: 'string' },
          state: { type: 'string', enum: ['running', 'needs_input', 'error', 'done'] },
          note: { type: 'string' },
        },
        required: ['id'],
      },
    })
    await $.command.register({ name: 'progress', description: 'Show or hide the progress rows above the prompt', argumentHint: '[show|hide]' })
    await $.command.register({ name: 'progress-clear', description: 'Remove every progress plan from the display' })
    $.clock.every(1000, () => {
      if (plans.size > 0 || agents.size > 0) $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const now = await $.clock.now()
    const id = typeof e.id === 'string' ? e.id.trim() : ''
    const existing = plans.get(id)
    const out = Array.isArray(e.stages) ? createPlan(e, now) : existing ? applyOp(existing, e, now) : { error: `No plan "${id}". Create it first with stages.` }
    if ('error' in out) return { deny: out.error }
    plans.set(out.plan.id, out.plan)
    $.ui.invalidate('ui.render')
    return { result: out.reply }
  })

  on('tool.call', async ($, e, next) => {
    try {
      const a = e.agentId === undefined ? undefined : agents.get(e.agentId)
      if (a) {
        a.tool = e.tool
        $.ui.invalidate('ui.render')
      }
    } catch {}
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.deny === undefined && r.agentId !== undefined) {
        agents.set(r.agentId, { name: e.name ?? e.description, model: r.model, startedAt: await $.clock.now() })
        $.ui.invalidate('ui.render')
      }
    } catch {}
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined && agents.delete(e.agentId)) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'task-progress:rules', text: RULES, scope: 'shared' }] }
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const arg = e.args.trim()
    isHidden = arg === 'hide' ? true : arg === 'show' ? false : !isHidden
    $.ui.invalidate('ui.render')
    return { text: isHidden ? 'Progress rows hidden.' : 'Progress rows shown.' }
  })

  on('command.run', { command: 'progress-clear' }, async ($) => {
    plans.clear()
    $.ui.invalidate('ui.render')
    return { text: 'Progress plans cleared.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (isHidden || e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    for (const p of [...plans.values()]) if (visible([p], now, keepMs).length === 0) plans.delete(p.id)
    const rows = [
      ...[...plans.values()].map(p => ({ text: planRow(p), color: COLORS[p.state] })),
      ...[...agents.values()].map(a => ({ text: agentRow(a, now), color: undefined as string | undefined })),
    ]
    if (rows.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: rows.map(r => Text({ color: r.color, dimColor: r.color === undefined, wrap: 'truncate-end', children: r.text })) })
  })
}
