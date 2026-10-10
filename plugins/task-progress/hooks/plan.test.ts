import { test, expect } from 'claude-code/testing'
import { agentRow, applyOp, bar, createPlan, elapsed, planRow, visible, type Plan } from './plan'

const make = (): Plan => {
  const out = createPlan({ id: 'p', title: 'Ship', stages: [{ name: 'Build', steps: [{ title: 'a' }, { title: 'b' }] }, { name: 'Test', steps: [{ title: 'c' }] }] }, 0)
  if ('error' in out) throw new Error(out.error)
  return out.plan
}

test('creating a plan activates the first step and draws a row', () => {
  expect(planRow(make())).toBe('Ship · Build · 0/3 steps · ░░░░░░░░░░ 0% · running')
})

test('creation rejects empty, duplicate and nameless input', () => {
  expect(createPlan({ id: '', stages: [] }, 0)).toEqual({ error: 'A plan needs an id.' })
  expect(createPlan({ id: 'x', stages: [] }, 0)).toEqual({ error: 'A plan needs at least one stage.' })
  expect('error' in createPlan({ id: 'x', stages: [{ name: 'S', steps: [{ title: 'a' }, { title: 'a' }] }] }, 0)).toBe(true)
  expect('error' in createPlan({ id: 'x', stages: [{ name: 'S', steps: [] }] }, 0)).toBe(true)
})

test('next finishes the current step and moves on, crossing stages', () => {
  const p = make()
  applyOp(p, { id: 'p', next: true }, 1)
  applyOp(p, { id: 'p', next: true }, 2)
  expect(planRow(p)).toBe('Ship · Test · 2/3 steps · ▓▓▓▓▓▓▓░░░ 67% · running')
})

test('an unknown step title is denied with the valid titles and changes nothing', () => {
  const p = make()
  const out = applyOp(p, { id: 'p', done: ['a', 'zzz'] }, 1)
  expect(out).toEqual({ error: 'Unknown step "zzz". Valid step titles: "a", "b", "c".' })
  expect(p.stages[0]?.steps[0]?.status).toBe('active')
})

test('failed sets error with a note; progress afterwards returns to running', () => {
  const p = make()
  applyOp(p, { id: 'p', failed: 'b', note: 'tests red' }, 1)
  expect(planRow(p)).toContain('error (tests red)')
  applyOp(p, { id: 'p', done: ['b'], active: 'c' }, 2)
  expect(p.state).toBe('running')
})

test('needs_input holds until the plan moves; finishing every step marks done', () => {
  const p = make()
  applyOp(p, { id: 'p', state: 'needs_input', note: 'which db?' }, 1)
  expect(p.state).toBe('needs_input')
  applyOp(p, { id: 'p', done: ['a', 'b', 'c'] }, 5)
  expect(p.state).toBe('done')
  expect(p.doneAt).toBe(5)
  expect('error' in applyOp(p, { id: 'p', state: 'bogus' }, 6)).toBe(true)
})

test('a done plan leaves after the keep time', () => {
  const p = make()
  applyOp(p, { id: 'p', done: ['a', 'b', 'c'] }, 1000)
  expect(visible([p], 30_999, 30_000)).toHaveLength(1)
  expect(visible([p], 31_000, 30_000)).toHaveLength(0)
})

test('bar, elapsed and agent rows', () => {
  expect(bar(50)).toBe('▓▓▓▓▓░░░░░')
  expect(bar(0, 4)).toBe('░░░░')
  expect(bar(100, 4)).toBe('▓▓▓▓')
  expect(elapsed(65_000)).toBe('1:05')
  expect(agentRow({ name: 'scan', model: 'haiku', tool: 'Grep', startedAt: 0 }, 9000)).toBe('↳ scan · haiku · Grep · 0:09')
  expect(agentRow({ name: 'scan', model: 'haiku', startedAt: 0 }, 0)).toBe('↳ scan · haiku · thinking · 0:00')
})
