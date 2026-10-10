import { test, expect, mock } from 'claude-code/testing'

const TOOL = 'mcp__task-progress__task_progress'
const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('plan lifecycle: create, update, deny unknown step, draw row, clear', async ($, on) => {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__task-progress__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start(START)

  const created = await $.tool.call({ tool: TOOL, id: 'p', title: 'Ship', stages: [{ name: 'Build', steps: [{ title: 'a' }, { title: 'b' }] }] })
  expect(created.deny).toBeUndefined()
  const bad = await $.tool.call({ tool: TOOL, id: 'p', done: ['nope'] })
  expect(bad.deny).toContain('Valid step titles: "a", "b"')
  await $.tool.call({ tool: TOOL, id: 'p', next: true })

  const ui = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 100, scroll: { bodyRows: 8 }, view: {} } as never })
  expect(await ui.find({ type: 'Text', text: /Ship · Build · 1\/2 steps · ▓▓▓▓▓░░░░░ 50% · running/ })).toBeDefined()
  await ui.unmount()

  expect((await $.command.run({ command: 'progress-clear', args: '' } as never)).text).toBe('Progress plans cleared.')
})
