export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
export type StepStatus = 'todo' | 'active' | 'done' | 'failed'
export type Step = { title: string; status: StepStatus }
export type Stage = { name: string; steps: Step[] }
export type Plan = { id: string; title: string; stages: Stage[]; state: PlanState; note?: string; doneAt?: number }
export type Agent = { name: string; model: string; tool?: string; startedAt: number }
export type Outcome = { plan: Plan; reply: string } | { error: string }

const STATES: readonly string[] = ['running', 'needs_input', 'error', 'done']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const RULES = `# Task progress
You have a tool, mcp__task-progress__task_progress, that drives a progress bar the person sees above their prompt. The bar shows only what you report; it cannot see your work, so keep it true.
- For a task with 3 or more steps, create a plan first: {id, title, stages:[{name, steps:[{title}]}]}. Use short, unique step titles. Skip it for smaller tasks.
- Update it as you go with short calls: {id, next:true} when the current step is finished; {id, done:[titles], active:title} to jump; {id, failed:title, note} when a step fails; {id, state:'needs_input'|'running'|'error'|'done', note} when your state changes.
- Set needs_input before you ask the person something. The plan completes itself when every step is done.
- This is a status display only. It never replaces doing or checking the work.`

export function createPlan(input: Record<string, unknown>, now: number): Outcome {
  const id = str(input.id)
  if (id === '') return { error: 'A plan needs an id.' }
  if (!Array.isArray(input.stages) || input.stages.length === 0) return { error: 'A plan needs at least one stage.' }
  const seen = new Set<string>()
  const stages: Stage[] = []
  for (const raw of input.stages) {
    const steps: Step[] = []
    for (const s of isObj(raw) && Array.isArray(raw.steps) ? raw.steps : []) {
      const title = str(isObj(s) ? s.title : s)
      if (title === '') return { error: 'Every step needs a title.' }
      if (seen.has(title)) return { error: `Step titles must be unique; "${title}" appears twice.` }
      seen.add(title)
      steps.push({ title, status: 'todo' })
    }
    if (steps.length === 0) return { error: 'Every stage needs at least one step.' }
    stages.push({ name: str(isObj(raw) ? raw.name : '') || `Stage ${stages.length + 1}`, steps })
  }
  const first = stages[0]?.steps[0]
  if (first) first.status = 'active'
  const plan: Plan = { id, title: str(input.title) || id, stages, state: 'running' }
  void now
  return { plan, reply: `Plan ${id} created: ${summary(plan)}` }
}

const stepsOf = (plan: Plan) => plan.stages.flatMap(s => s.steps)

export function summary(plan: Plan): string {
  const steps = stepsOf(plan)
  const done = steps.filter(s => s.status === 'done').length
  const next = steps.find(s => s.status === 'active')?.title
  return `${done}/${steps.length} done${next ? `; current: ${next}` : ''}.`
}

export function applyOp(plan: Plan, op: Record<string, unknown>, now: number): Outcome {
  const steps = stepsOf(plan)
  const find = (title: string) => steps.find(s => s.title === title)
  const unknown = (title: string): Outcome => ({
    error: `Unknown step "${title}". Valid step titles: ${steps.map(s => `"${s.title}"`).join(', ')}.`,
  })
  const doneTitles = Array.isArray(op.done) ? op.done.map(str) : []
  const active = str(op.active)
  const failed = str(op.failed)
  for (const t of [...doneTitles, active, failed]) if (t !== '' && !find(t)) return unknown(t)
  const state = str(op.state)
  if (state !== '' && !STATES.includes(state)) return { error: `Unknown state "${state}". Use ${STATES.join(', ')}.` }

  let moved = false
  if (op.next === true) {
    const current = steps.find(s => s.status === 'active') ?? steps.find(s => s.status === 'todo')
    if (current) current.status = 'done'
    const upcoming = steps.find(s => s.status === 'todo')
    if (upcoming) upcoming.status = 'active'
    moved = true
  }
  for (const t of doneTitles) (find(t) as Step).status = 'done'
  if (doneTitles.length > 0) moved = true
  if (active !== '') {
    for (const s of steps) if (s.status === 'active') s.status = 'todo'
    ;(find(active) as Step).status = 'active'
    moved = true
  }
  if (moved && (plan.state === 'error' || plan.state === 'needs_input')) plan.state = 'running'
  if (failed !== '') {
    ;(find(failed) as Step).status = 'failed'
    plan.state = 'error'
    plan.note = str(op.note) || undefined
  } else if (state !== '') {
    plan.state = state as PlanState
    plan.note = str(op.note) || undefined
  }
  if (steps.every(s => s.status === 'done')) plan.state = 'done'
  if (plan.state === 'done') plan.doneAt ??= now
  else delete plan.doneAt
  return { plan, reply: `${plan.id}: ${plan.state}, ${summary(plan)}` }
}

export function bar(percent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

export function planRow(plan: Plan): string {
  const steps = stepsOf(plan)
  const done = steps.filter(s => s.status === 'done').length
  const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100)
  const stage =
    plan.stages.find(s => s.steps.some(x => x.status === 'active')) ??
    plan.stages.find(s => s.steps.some(x => x.status !== 'done')) ??
    plan.stages[plan.stages.length - 1]
  const note = plan.note ? ` (${plan.note})` : ''
  return `${plan.title} · ${stage?.name ?? ''} · ${done}/${steps.length} steps · ${bar(percent)} ${percent}% · ${plan.state}${note}`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const agentRow = (a: Agent, now: number) =>
  `↳ ${a.name} · ${a.model} · ${a.tool ?? 'thinking'} · ${elapsed(now - a.startedAt)}`

// Plans still on screen: a done plan leaves once `keepMs` has passed.
export function visible(plans: Plan[], now: number, keepMs: number): Plan[] {
  return plans.filter(p => p.state !== 'done' || now - (p.doneAt ?? now) < keepMs)
}
