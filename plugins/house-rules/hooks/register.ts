import type { Register } from 'claude-code'
import { MCP_ISSUE, MCP_MOVES, activatesChecklist, commitFile, commitSubject, fileLocation, firstLine, moves, prTitle, statusProblem, stdinSubject, subjectProblem, writtenSubject, type Title } from './rules'
import { checkStrip, looksLikeStrip, type Item } from './strip'

const ASKED = /goal-?checklist|where are we|status on/i

export const register: Register = (on, options) => {
  const checkStatusLine = options.checkStatusLine === true
  const enforceCommitRule = options.enforceCommitRule === true
  let prev: Item[] | undefined
  let prompt = ''
  let moved = false

  on('turn.start', async ($, e, next) => {
    prompt = e.text
    moved = false
    if (activatesChecklist(e.text)) await $.state.set({ plugin: 'house-rules', key: 'isChecklistActive' }, true)
    return next(e)
  })

  on('tool.call', { tool: MCP_MOVES }, ($, e, next) => {
    moved = true
    return next(e)
  })

  on('tool.call', { tool: MCP_ISSUE }, ($, e, next) => {
    if ((e as { state?: string }).state === 'closed') moved = true
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (moves(e.command)) moved = true
    if (!enforceCommitRule) return next(e)
    const commit = commitSubject(e.command)
    let t: Title | undefined = commit ?? prTitle(e.command)
    const file = commitFile(e.command)
    if (file !== undefined) {
      // A file the same command writes first doesn't exist yet: take its title from the command.
      const written = file === '-' || /[$`]/.test(file) ? undefined : writtenSubject(e.command, file)
      if (written) t = written
      else {
        const path = file === '-' ? undefined : fileLocation(e.command, file)
        const text =
          file === '-'
            ? stdinSubject(e.command)
            : path === undefined
              ? undefined
              : await $.fs.read(path).then(firstLine, () => undefined)
        if (text === undefined || /[$`]/.test(file))
          return { deny: `${$.plugin.name}: commit message ${file === '-' ? 'from stdin' : `file ${file}`} can't be read — pass the subject with -m.` }
        t = { text, dynamic: false }
      }
    }
    const problem = t === undefined ? undefined : subjectProblem(t.text, t.dynamic)
    if (t !== undefined && problem !== undefined)
      return { deny: `${$.plugin.name}: ${commit || file !== undefined ? 'commit' : 'PR title'} "${t.text}" — ${problem}.` }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` }))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') {
      const { value: isActive } = await $.state.get({ plugin: 'house-rules', key: 'isChecklistActive' })
      const stray = !isActive && looksLikeStrip(e.answer)
      const strip = stray ? { problems: [] as string[], items: undefined } : checkStrip(e.answer, prev, ASKED.test(prompt))
      const problems = [checkStatusLine ? statusProblem(e.answer) : undefined, ...strip.problems]
      if (stray) problems.push('a strip was printed but no goal-checklist is active: leave it out')
      if (strip.items) prev = strip.items
      else if (prev && moved) problems.push('a PR or deploy ran but no strip was printed')
      const found = problems.filter(Boolean)
      if (found.length) $.ui.toast(`${$.plugin.name}: ${found.join(' · ')}`)
    }
    moved = false
    return result
  })
}
