import { test, expect } from 'claude-code/testing'
import { MCP_ISSUE, MCP_MOVES, activatesChecklist, commitFile, commitSubject, fileLocation, firstLine, moves, prTitle, statusProblem, stdinSubject, subjectProblem, writtenSubject } from './rules'
import { checkStrip, looksLikeStrip } from './strip'
import { register } from './register'

test('accepts a good subject', () => {
  expect(subjectProblem('fix(auth): reject expired tokens')).toBeUndefined()
})
test('rejects bad subjects', () => {
  expect(subjectProblem('Fixed the thing')).toBeDefined()
  expect(subjectProblem('fix(auth): Reject tokens')).toBeDefined()
  expect(subjectProblem('fix(auth): reject tokens.')).toBeDefined()
  expect(subjectProblem('feat: ' + 'a'.repeat(50))).toBeDefined()
})
test('extracts commit subjects', () => {
  expect(commitSubject('git commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(commitSubject("git commit -am 'feat(x): y'")?.text).toBe('feat(x): y')
  expect(commitSubject('git commit -m "$(cat <<\'EOF\'\nfix: a b\n\nbody\nEOF\n)"')).toEqual({ text: 'fix: a b', dynamic: false })
  expect(commitSubject('git status')).toBeUndefined()
})
test('flags titles the shell expands', () => {
  expect(commitSubject('git commit -m "$MSG"')?.dynamic).toBe(true)
  expect(commitSubject('git commit -m "fix: $(date)"')?.dynamic).toBe(true)
  expect(commitSubject("git commit -m 'fix: costs $5'")?.dynamic).toBe(false)
  expect(prTitle('gh pr create --title "$T"')?.dynamic).toBe(true)
  expect(subjectProblem('$MSG', true)).toBeDefined()
})
test('extracts PR titles', () => {
  expect(prTitle('gh pr create --title "feat: x y" --body z')?.text).toBe('feat: x y')
  expect(prTitle('gh pr list')).toBeUndefined()
})
test('finds commit message files', () => {
  expect(commitFile('git commit -F msg.txt')).toBe('msg.txt')
  expect(commitFile('git commit --file "my msg.txt"')).toBe('my msg.txt')
  expect(commitFile("git commit -F - <<'EOF'\nfix: a\nEOF")).toBe('-')
  expect(commitFile('git commit -m "fix: a" -F msg.txt')).toBeUndefined()
  expect(commitFile('git log -F x')).toBeUndefined()
  expect(stdinSubject("git commit -F - <<'EOF'\nfix: a b\n\nbody\nEOF")).toBe('fix: a b')
  expect(firstLine('\n\nfix: a b\nbody')).toBe('fix: a b')
})
test('follows cd to where the message file is', () => {
  const at = (cmd: string, f = 'msg.txt') => fileLocation(cmd, f)
  expect(at('git commit -F msg.txt')).toBe('msg.txt')
  expect(at('cd app && git commit -F msg.txt')).toBe('app/msg.txt')
  expect(at('cd app; cd sub && git commit -F msg.txt')).toBe('app/sub/msg.txt')
  expect(at('cd /tmp/repo && git commit -F msg.txt')).toBe('/tmp/repo/msg.txt')
  expect(at('cd "my dir" && git commit -F msg.txt')).toBe('my dir/msg.txt')
  expect(at('cd app && git commit -F /abs/msg.txt', '/abs/msg.txt')).toBe('/abs/msg.txt')
  expect(at('cd $DIR && git commit -F msg.txt')).toBeUndefined()
  expect(at('cd ~/repo && git commit -F msg.txt')).toBeUndefined()
  expect(at('cd - && git commit -F msg.txt')).toBeUndefined()
  expect(at('git commit -F msg.txt && cd app')).toBe('msg.txt')
})
test('reads -F from the work tree when --work-tree is set, as git does', () => {
  expect(fileLocation('git --work-tree=wt commit -F m', 'm')).toBe('wt/m')
  expect(fileLocation('git --git-dir=g --work-tree wt commit -F m', 'm')).toBe('wt/m')
  expect(fileLocation('git --git-dir=g commit -F m', 'm')).toBe('m')
  expect(fileLocation('cd a && git --work-tree=wt commit -F m', 'm')).toBe('a/wt/m')
  expect(fileLocation('git --work-tree=/abs/wt commit -F m', 'm')).toBe('/abs/wt/m')
  expect(fileLocation('git --work-tree=$W commit -F m', 'm')).toBeUndefined()
})
test('takes the title from a message file the same command writes', () => {
  const w = writtenSubject
  expect(w('echo "fix: x" > msg.txt && git commit -F msg.txt', 'msg.txt')).toEqual({ text: 'fix: x', dynamic: false })
  expect(w("echo 'Fix: x' > msg.txt; git commit -F msg.txt", 'msg.txt')?.text).toBe('Fix: x')
  expect(w('printf "fix: x\\n\\nbody" > msg.txt && git commit -F msg.txt', 'msg.txt')?.text).toBe('fix: x')
  expect(w('echo -e "fix: x\\nbody" > "m s.txt" && git commit -F "m s.txt"', 'm s.txt')?.text).toBe('fix: x')
  expect(w("cat > msg.txt <<'EOF'\nfix: x\n\nbody\nEOF\ngit commit -F msg.txt", 'msg.txt')).toEqual({ text: 'fix: x', dynamic: false })
  expect(w("cat <<'EOF' > msg.txt\nfix: x\nEOF\ngit commit -F msg.txt", 'msg.txt')?.text).toBe('fix: x')
  expect(w('cat > msg.txt <<EOF\nfix: $T\nEOF\ngit commit -F msg.txt', 'msg.txt')?.dynamic).toBe(true)
  expect(w('echo "fix: $T" > msg.txt && git commit -F msg.txt', 'msg.txt')?.dynamic).toBe(true)
  expect(w("echo 'fix: $5' > msg.txt && git commit -F msg.txt", 'msg.txt')?.dynamic).toBe(false)
  expect(w('echo "fix: x" >> msg.txt && git commit -F msg.txt', 'msg.txt')).toBeUndefined()
  expect(w('echo "fix: x" > other.txt && git commit -F msg.txt', 'msg.txt')).toBeUndefined()
  expect(w('printf "%s\\n" "fix: x" > msg.txt && git commit -F msg.txt', 'msg.txt')).toBeUndefined()
  expect(w('git commit -F msg.txt && echo "fix: x" > msg.txt', 'msg.txt')).toBeUndefined()
})
test('stops an unquoted value at ; & | and )', () => {
  expect(commitFile('git commit -F msg.txt; echo done')).toBe('msg.txt')
  expect(commitSubject('git commit -m fix:a;echo x')?.text).toBe('fix:a')
  expect(prTitle('gh pr create --title feat:a && echo x')?.text).toBe('feat:a')
})
test('recognises git commit behind global options', () => {
  expect(commitSubject('git -C app commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(commitSubject('git -c user.name=x --no-pager commit -m "Bad"')?.text).toBe('Bad')
  expect(commitSubject('git -C "my dir" commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(commitSubject('git --git-dir=.git commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(commitSubject('git --git-dir .git commit -m "Bad"')?.text).toBe('Bad')
  expect(commitSubject('git --work-tree=w --git-dir "g d" commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(commitSubject('git --git-dir .git status -m "Bad"')).toBeUndefined()
  expect(commitFile('git -C app commit -F msg.txt')).toBe('msg.txt')
  expect(fileLocation('git -C app commit -F msg.txt', 'msg.txt')).toBe('app/msg.txt')
  expect(fileLocation('cd a && git -C b commit -F m', 'm')).toBe('a/b/m')
  expect(fileLocation('git -C $D commit -F m', 'm')).toBeUndefined()
  expect(commitSubject('git -C app status')).toBeUndefined()
  expect(commitSubject('git log -m x')).toBeUndefined()
})
test('ignores command text that is only written into a file', () => {
  const doc = "cat > notes.md <<'EOF'\nrun git commit -m beside it\ngh pr merge 5\nEOF"
  expect(commitSubject(doc)).toBeUndefined()
  expect(moves(doc)).toBe(false)
  expect(commitSubject('echo hi && git commit -m "fix: a b"')?.text).toBe('fix: a b')
  expect(moves('cd x && gh pr merge 5 --squash')).toBe(true)
  expect(moves('npm run deploy')).toBe(true)
  expect(moves('ls deploy')).toBe(false)
})
test('matches the GitHub MCP tools that move an item', () => {
  expect(MCP_MOVES.test('mcp__plugin_github_github__merge_pull_request')).toBe(true)
  expect(MCP_MOVES.test('mcp__MCP_DOCKER__github-official__create_pull_request')).toBe(true)
  expect(MCP_MOVES.test('mcp__plugin_github_github__list_issues')).toBe(false)
  expect(MCP_ISSUE.test('mcp__MCP_DOCKER__github-official__issue_write')).toBe(true)
})
test('checks the status line', () => {
  expect(statusProblem('done\n\n🟢 Built it')).toBeUndefined()
  expect(statusProblem('🟢 Built it\nmore text')).toBeDefined()
  expect(statusProblem('no status')).toBeDefined()
  expect(statusProblem('x\n🟢 ' + 'a'.repeat(100))).toBeDefined()
})

const flowing = `🔄 #6794 (PR #6837), 🟦 #6806 (0bb9fc1ac), ⬜ #6812, ⬜ #6827
· 2⬜ not started · 1🔄 in progress · 1🟦 on dev · 4 total

🟢 Done`
const grouped = `⬜ #6337, #6812
🔄 #6830 1/5 (steps 2-5 designed)
🟦 #6794 (8b0380d2d), #6806 (0bb9fc1ac)
🔍 #6807 (needs deploy)
⏸️ on #6830: #6805 #6817 · #6804 (blocked on #6794)
· 2⬜ not started · 1🔄 in progress · 2🟦 on dev · 1🔍 unproven · 3⏸️ blocked · 9 total

🟡 Pending`

test('accepts both strip layouts', () => {
  expect(checkStrip(flowing, undefined, false).problems).toEqual([])
  const g = checkStrip(grouped, undefined, false)
  expect(g.problems).toEqual([])
  expect(g.items?.length).toBe(9)
})
test('no strip is not a problem by itself', () => {
  expect(checkStrip('just text\n\n🟢 Done', undefined, false)).toEqual({ problems: [] })
})
test('catches strip rule breaks', () => {
  const p = (s: string) => checkStrip(s, undefined, false).problems.join('|')
  expect(p(flowing.replace(' (0bb9fc1ac)', ''))).toContain('without its merge SHA')
  expect(p(flowing.replace('4 total', '5 total'))).toContain('tally does not match')
  expect(p(flowing.replace('⬜ #6812, ⬜ #6827', '⬜ #6827, ⬜ #6812'))).toContain('out of order')
  expect(p(grouped.replace('(blocked on #6794)', ''))).toContain('no blocker named')
  expect(p(flowing.replace('· 2⬜ not started · 1🔄 in progress · 1🟦 on dev · 4 total\n', ''))).toContain('no tally')
  expect(p(flowing.replace('\n\n🟢 Done', '\n\nnotes\n\n🟢 Done'))).toContain('not directly above')
})
test('compares against the previous strip', () => {
  const prev = checkStrip(flowing, undefined, false).items
  expect(checkStrip(flowing, prev, false).problems.join()).toContain('unchanged')
  expect(checkStrip(flowing, prev, true).problems).toEqual([])
  const jumped = flowing.replace('⬜ #6812', '🟦 #6812 (abc1234)').replace('2⬜', '1⬜').replace('1🟦', '2🟦')
  expect(checkStrip(jumped, prev, false).problems.join()).toContain('#6812 jumped ⬜→🟦')
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bashHook = (options: Record<string, boolean>): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hook: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on: any = (event: string, matcher: any, h: any) => {
    if (event === 'tool.call' && matcher?.tool === 'Bash') hook = h
    return { catch: () => undefined }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(on, options as any)
  return hook
}
const callBash = (options: Record<string, boolean>, command: string) =>
  bashHook(options)({ plugin: { name: 'house-rules' }, fs: { read: async () => '' } }, { command }, async () => ({ passed: true }))

test('the commit rule is off unless the option is on', async () => {
  const bad = 'git commit -m "Fixed the thing"'
  expect(await callBash({}, bad)).toEqual({ passed: true })
  expect(await callBash({ enforceCommitRule: false }, bad)).toEqual({ passed: true })
  expect((await callBash({ enforceCommitRule: true }, bad)).deny).toContain('Fixed the thing')
  expect(await callBash({ enforceCommitRule: true }, 'git commit -m "fix: a b"')).toEqual({ passed: true })
})

test('knows which prompts start a checklist', () => {
  expect(activatesChecklist('/goal-checklist 6830, 6807, 6806')).toBe(true)
  expect(activatesChecklist('/goal-checklist +6840')).toBe(true)
  expect(activatesChecklist('/goal-checklist ⬜ 6830 🟦 6807')).toBe(true)
  expect(activatesChecklist('here is the last strip\n🟦 #6794 (8b0380d2d), #6806')).toBe(true)
  expect(activatesChecklist('/goal-checklist')).toBe(false)
  expect(activatesChecklist('/goal-checklist --help')).toBe(false)
  expect(activatesChecklist('are we still working on our issues?')).toBe(false)
  expect(activatesChecklist('fix #9630 please')).toBe(false)
})

test('spots a strip, well formed or not', () => {
  const loose = '🔄 promotion A = PR #9630 (unit lane running)\n🟦 #9604, #9605\n· 0⬜ · 2🔄 · 6🟦 (#4375 not shipped)\n\n🟡 ok'
  expect(looksLikeStrip(loose)).toBe(true)
  expect(looksLikeStrip(flowing)).toBe(true)
  expect(looksLikeStrip('Yes, both threads are moving.\n\n🟡 ok')).toBe(false)
  expect(looksLikeStrip('see #9630 and #9604')).toBe(false)
})

// The whole mod with the engine stubbed: hooks by event, session state held in a map.
const session = (options: Record<string, boolean> = {}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooks: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on: any = (event: string, a: any, b: any) => ((hooks[event] = b ?? a), { catch: () => undefined })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(on, options as any)
  const state = new Map<string, unknown>()
  const toasts: string[] = []
  const $ = {
    plugin: { name: 'house-rules' },
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key) }),
      set: async (ref: { key: string }, v: unknown) => void state.set(ref.key, v),
    },
    ui: { toast: (t: string) => toasts.push(t) },
  }
  const pass = async (e: unknown) => e
  return {
    toasts,
    say: async (prompt: string, answer: string) => {
      await hooks['turn.start']($, { text: prompt }, pass)
      await hooks['turn.complete']($, { answer, reason: 'answer' }, pass)
    },
  }
}
const stray = '🔄 promotion A = PR #9630\n🟦 #9604, #9605\n· 0⬜ · 2🔄 · 6🟦 (#4375 not shipped)\n\n🟡 ok'

test('a strip with no active checklist is flagged as unwanted, not as malformed', async () => {
  const s = session()
  await s.say('are we still working on our issues?', stray)
  expect(s.toasts).toEqual(['house-rules: a strip was printed but no goal-checklist is active: leave it out'])
})

test('once a checklist is started, strips are checked for format as before', async () => {
  const s = session()
  await s.say('/goal-checklist 9604, 9605', stray)
  expect(s.toasts.join()).toContain('no tally line')
  expect(s.toasts.join()).not.toContain('no goal-checklist is active')
})

test('replies without a strip draw no strip warning', async () => {
  const s = session()
  await s.say('are we still working on our issues?', 'Yes, both threads are moving.\n\n🟡 ok')
  expect(s.toasts).toEqual([])
})
