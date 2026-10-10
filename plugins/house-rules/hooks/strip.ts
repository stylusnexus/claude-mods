export type Item = { num: number; sym: string; frac?: string; note?: string }
export type Checked = { problems: string[]; items?: Item[] }

const BANDS = '⬜|🔄|🟦|🚀|✅|🔍|⏸'
const STAGE: Record<string, number> = { '⬜': 0, '🔄': 1, '🟦': 2, '🚀': 3, '✅': 4 }
const TALLY = /^·\s.*\b\d+ total\s*$/u
const HEAD = new RegExp(`^(\\s|${BANDS})`, 'u')
const ORPHAN = new RegExp(`^(${BANDS})\\uFE0F?\\s+#\\d+`, 'mu')
const SHA = /^[0-9a-f]{7,}\b/
const STATUS_EMOJI = /^[🟢🟡🔴] /u

const tokens = () =>
  new RegExp(`(${BANDS})\\uFE0F?|(on\\s+#\\d+:)|( · )|#(\\d+)(?:\\s+(\\d+\\/\\d+))?(?:\\s*\\(((?:[^()]|\\([^()]*\\))*)\\))?`, 'gu')

const key = (items: Item[]) =>
  items.map(i => `${i.num}${i.sym}${i.frac ?? ''}`).sort().join(',')

// True when the reply holds a goal-checklist strip, well formed or not.
export const looksLikeStrip = (answer: string): boolean =>
  ORPHAN.test(answer) || answer.split('\n').some(l => TALLY.test(l.trim()))

// Reads the goal-checklist strip printed in `answer` and returns what breaks the skill's rules.
// `prev` is the last strip seen; `requested` means the user asked for the strip, so repeating it is fine.
export const checkStrip = (answer: string, prev: Item[] | undefined, requested: boolean): Checked => {
  const lines = answer.trimEnd().split('\n')
  let t = -1
  for (let i = lines.length - 1; i >= 0; i--) if (TALLY.test(lines[i]!.trim())) { t = i; break }
  if (t < 0) return ORPHAN.test(answer) ? { problems: ['strip has no tally line'] } : { problems: [] }

  let a = t
  while (a > 0 && lines[a - 1]!.trim() !== '' && HEAD.test(lines[a - 1]!)) a--

  const problems: string[] = []
  const items: Item[] = []
  const lastNum: Record<string, number> = {}
  let cur = ''
  let named = false
  for (const line of lines.slice(a, t)) {
    for (const m of line.matchAll(tokens())) {
      if (m[1]) { cur = m[1]; named = false }
      else if (m[2]) named = true
      else if (m[3]) named = false
      else if (m[4]) {
        const item: Item = { num: Number(m[4]), sym: cur, frac: m[5], note: m[6] }
        items.push(item)
        const tag = `#${item.num}`
        if ((cur === '🟦' || cur === '🚀') && !SHA.test(item.note ?? ''))
          problems.push(`${tag} is ${cur} without its merge SHA`)
        if (cur === '⏸' && !named && !(item.note ?? '').trim())
          problems.push(`${tag} is ⏸️ with no blocker named`)
        if (cur !== '⏸') {
          if (item.num < (lastNum[cur] ?? 0)) problems.push(`${tag} is out of order in its row`)
          lastNum[cur] = item.num
        }
      }
    }
  }

  const counts: Record<string, number> = {}
  for (const i of items) counts[i.sym] = (counts[i.sym] ?? 0) + 1
  const tally = lines[t]!
  const said: Record<string, number> = {}
  for (const m of tally.matchAll(new RegExp(`(\\d+)(${BANDS})\\uFE0F?`, 'gu'))) said[m[2]!] = Number(m[1])
  const total = Number(/(\d+) total/.exec(tally)?.[1])
  const wrong =
    total !== items.length ||
    Object.keys({ ...counts, ...said }).some(s => (counts[s] ?? 0) !== (said[s] ?? 0))
  if (wrong) problems.push(`tally does not match the ${items.length} items in the strip`)

  const after = lines.slice(t + 1).filter(l => l.trim() !== '')
  if (after.length > 1 || (after.length === 1 && !STATUS_EMOJI.test(after[0]!)))
    problems.push('strip is not directly above the status line')

  if (prev) {
    const before = new Map(prev.map(i => [i.num, i.sym]))
    for (const i of items) {
      const from = STAGE[before.get(i.num) ?? '']
      const to = STAGE[i.sym]
      if (from !== undefined && to !== undefined && to - from > 1)
        problems.push(`#${i.num} jumped ${before.get(i.num)}→${i.sym}, skipping a stage`)
    }
    if (!requested && key(prev) === key(items))
      problems.push('strip unchanged since the last one — skip it when nothing moved')
  }
  return { problems, items }
}
