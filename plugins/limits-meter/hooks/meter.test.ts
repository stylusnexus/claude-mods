import { test, expect } from 'claude-code/testing'
import { statusText, step, warning } from './meter'

test('status line shows each window and the running agents', () => {
  expect(statusText([{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 7 }], 2)).toBe(
    '5h 42% · wk 7% · 2 agents',
  )
  expect(statusText([{ kind: 'five_hour', percentUsed: 10 }], 1)).toBe('5h 10% · 1 agent')
  expect(statusText([], 3)).toBe('3 agents')
  expect(statusText([], 0)).toBeUndefined()
  expect(statusText([{ kind: 'spend_limit', percentUsed: 120 }], 0)).toBe('spend 120%')
  expect(statusText([{ kind: 'odd', percentUsed: 1 }], 0)).toBe('odd 1%')
})

test('announces once per level and again after the window clears', () => {
  expect(step(0, 80)).toEqual({ seen: 0 })
  expect(step(0, 91)).toEqual({ seen: 90, announce: 90 })
  expect(step(90, 93)).toEqual({ seen: 90 })
  expect(step(90, 96)).toEqual({ seen: 95, announce: 95 })
  expect(step(95, 96)).toEqual({ seen: 95 })
  expect(step(95, 88)).toEqual({ seen: 95 })
  expect(step(95, 40)).toEqual({ seen: 0 })
  expect(step(0, 97)).toEqual({ seen: 95, announce: 95 })
})

test('warnings say what to do and when the window clears', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const at = (iso?: string) => ({ kind: 'five_hour', percentUsed: 96.2, resetsAt: iso })
  expect(warning(at('2026-10-09T13:12:00Z'), 95, now)).toBe('5h window at 96%. Stop launching new work. Resets in 1h 12m.')
  expect(warning(at('2026-10-09T12:20:00Z'), 90, now)).toBe(
    '5h window at 96%. Finish the current wave; start no more. Resets in 20m.',
  )
  expect(warning(at(), 95, now)).toBe('5h window at 96%. Stop launching new work.')
  expect(warning(at('2026-10-09T11:00:00Z'), 95, now)).toBe('5h window at 96%. Stop launching new work.')
})
