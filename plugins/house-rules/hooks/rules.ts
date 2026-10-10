const TYPES = 'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
const SUBJECT = new RegExp(`^(${TYPES})(\\([a-z0-9._/-]+\\))?!?: [^A-Z\\s].*[^.\\s]$`)
const STATUS = /^[🟢🟡🔴] \S/u
const AT_START = String.raw`(?:^|[;&|(]\s*|\n\s*)`
const ARG = String.raw`(?:"[^"]+"|'[^']+'|[^\s"';&|)]+)`
const GIT_OPTS = String.raw`(?:\s+(?:-[Cc]\s+${ARG}|--(?:git-dir|work-tree|namespace|super-prefix|config-env)\s+${ARG}|--[a-z-]+(?:=${ARG})?|-p))*`
const GIT_COMMIT = new RegExp(`${AT_START}git${GIT_OPTS}\\s+commit\\b`)
const GH_PR_CREATE = new RegExp(`${AT_START}gh\\s+pr\\s+create\\b`)
const MOVES = new RegExp(
  `${AT_START}(?:gh\\s+(?:pr\\s+(?:merge|create)|issue\\s+close)\\b|(?:vercel|render|fly|wrangler)\\b[^\\n]*\\bdeploy\\b|(?:npm|pnpm|yarn)\\s+(?:run\\s+)?deploy\\b)`,
)

export const subjectProblem = (subject: string, dynamic = false): string | undefined => {
  if (dynamic) return 'built from a shell variable or substitution — write the subject out so it can be checked'
  if (subject.length > 50) return `subject is ${subject.length} chars, limit is 50`
  if (!SUBJECT.test(subject))
    return 'use "type(scope): imperative summary" — lowercase after the colon, no trailing period'
  return undefined
}

// Drops the body of any heredoc that is not feeding git commit or gh pr, so text a command
// merely writes into a file is never read as a command.
export const scrub = (cmd: string): string =>
  cmd.replace(
    /^([^\n]*)<<-?\s*(['"]?)(\w+)\2[^\n]*\n[\s\S]*?\n[ \t]*\3[ \t]*$/gm,
    (all, head: string) => (/\bgit\s+commit\b|\bgh\s+pr\b/.test(head) ? all : `${head}<<`),
  )

const first = (m: RegExpMatchArray | null) => m?.slice(1).find(g => g !== undefined)

export type Title = { text: string; dynamic: boolean }

// A title is dynamic when the shell will expand it before git or gh sees it.
const title = (m: RegExpMatchArray | null): Title | undefined => {
  const text = first(m)?.trim()
  if (text === undefined) return undefined
  const single = m![0].trimEnd().includes("'" + text)
  return { text, dynamic: !single && /[$`]/.test(text) }
}

export const commitSubject = (raw: string): Title | undefined => {
  const cmd = scrub(raw)
  if (!GIT_COMMIT.test(cmd)) return undefined
  const heredoc = cmd.match(/(?:\s-[a-zA-Z]*m|\s--message[= ])\s*"\$\(cat <<-?\\?'?"?EOF"?'?\n([^\n]*)/)
  if (heredoc) return { text: heredoc[1]!.trim(), dynamic: false }
  return title(cmd.match(/(?:\s-[a-zA-Z]*m|\s--message[= ])\s*(?:"([^"\n]*)|'([^'\n]*)|([^\s"';&|)]+))/))
}

export const prTitle = (raw: string): Title | undefined => {
  const cmd = scrub(raw)
  if (!GH_PR_CREATE.test(cmd)) return undefined
  return title(cmd.match(/(?:\s-t|\s--title[= ])\s*(?:"([^"\n]*)|'([^'\n]*)|([^\s"';&|)]+))/))
}

// `git commit -F path` or `--file path`, with no -m beside it. `-` means stdin.
export const commitFile = (raw: string): string | undefined => {
  const cmd = scrub(raw)
  if (!GIT_COMMIT.test(cmd) || commitSubject(cmd)) return undefined
  return first(cmd.match(/\s(?:-[a-zA-Z]*F|--file[= ])\s*(?:"([^"]+)"|'([^']+)'|([^\s"';&|)]+))/))
}

// Where `file` is once the `cd`s before git commit and any `git -C dir` have applied;
// undefined when one goes somewhere the plugin can't resolve (a variable, `~`, `cd -`).
export const fileLocation = (raw: string, file: string): string | undefined => {
  const cmd = scrub(raw)
  const hit = GIT_COMMIT.exec(cmd)
  const steps: { to: string; tree: boolean }[] = []
  for (const m of cmd.slice(0, hit?.index ?? 0).matchAll(
    new RegExp(`${AT_START}cd\\s+(?:"([^"]+)"|'([^']+)'|([^\\s;&|)]+))`, 'g'),
  ))
    steps.push({ to: (m[1] ?? m[2] ?? m[3])!, tree: false })
  // git reads a relative -F path from the work tree when --work-tree names one.
  for (const m of (hit?.[0] ?? '').matchAll(
    /\s(-C\s+|--work-tree(?:=|\s+))(?:"([^"]+)"|'([^']+)'|([^\s"';&|)]+))/g,
  ))
    steps.push({ to: (m[2] ?? m[3] ?? m[4])!, tree: m[1]!.startsWith('--') })

  let dir = ''
  let tree: string | undefined
  for (const { to, tree: isTree } of steps) {
    if (to === '-' || /[$`~]/.test(to)) return undefined
    const at = to.startsWith('/') || dir === '' ? to : `${dir}/${to}`
    if (isTree) tree = at
    else dir = at
  }
  const base = tree ?? dir
  return file.startsWith('/') || base === '' ? file : `${base}/${file}`
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The title of a message file the same command writes before it commits, from
// `echo`/`printf` text or a `cat` heredoc redirected into it. `>>` is not a write the
// plugin can follow, as the file may already hold text.
export const writtenSubject = (raw: string, file: string): Title | undefined => {
  const at = GIT_COMMIT.exec(raw)?.index ?? raw.length
  const head = raw.slice(0, at)
  const f = `["']?${esc(file)}["']?(?![\\w./-])`
  const line = (text: string) => text.split(/\\n|\n/).find(l => l.trim() !== '')?.trim()

  const echo = head.match(
    new RegExp(`${AT_START}(echo|printf)\\s+(?:-[a-zA-Z]+\\s+)*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s"';&|<>]+))\\s*>(?!>)\\s*${f}`),
  )
  if (echo) {
    const text = echo[2] ?? echo[3] ?? echo[4]!
    if (echo[1] === 'printf' && text.includes('%')) return undefined
    const title = line(text)
    return title === undefined ? undefined : { text: title, dynamic: echo[3] === undefined && /[$`]/.test(text) }
  }

  const doc =
    head.match(new RegExp(`\\bcat\\s*>\\s*${f}\\s*<<-?\\s*(['"]?)(\\w+)\\1[ \\t]*\\n[ \\t]*([^\\n]*)`)) ??
    head.match(new RegExp(`\\bcat\\s*<<-?\\s*(['"]?)(\\w+)\\1\\s*>\\s*${f}[ \\t]*\\n[ \\t]*([^\\n]*)`))
  if (doc) return { text: doc[3]!.trim(), dynamic: doc[1] === '' && /[$`]/.test(doc[3]!) }
  return undefined
}

// The first line of a heredoc fed to `git commit -F -`.
export const stdinSubject = (cmd: string): string | undefined =>
  cmd.match(/<<-?\s*['"]?(\w+)['"]?[ \t]*\n[ \t]*([^\n]*)/)?.[2]?.trim()

export const firstLine = (text: string): string | undefined =>
  text.split('\n').find(l => l.trim() !== '')?.trim()

export const moves = (cmd: string): boolean => MOVES.test(scrub(cmd))

export const MCP_MOVES = /^mcp__.+__(merge_pull_request|create_pull_request)$/
export const MCP_ISSUE = /^mcp__.+__issue_write$/

export const statusProblem = (answer: string): string | undefined => {
  const lines = answer.trimEnd().split('\n')
  const last = lines[lines.length - 1] ?? ''
  if (!STATUS.test(last)) return 'reply does not end on a 🟢/🟡/🔴 status line'
  if ([...last].length > 100) return 'status line is over 100 characters'
  return undefined
}

// A prompt that seeds, adds to, drops from or restores a goal-checklist: the skill invoked with
// issue numbers or symbols, or a pasted strip. A bare /goal-checklist or --help starts nothing.
export const activatesChecklist = (prompt: string): boolean =>
  /\/goal-checklist\s+[^\n]*(#?\d{2,}|[⬜🔄🟦🚀✅🔍⏸])/u.test(prompt) ||
  /^\s*(⬜|🔄|🟦|🚀|✅|🔍|⏸)\uFE0F?\s+#\d+/mu.test(prompt)
