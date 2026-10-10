# Claude Code mods

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude%20Code-mods-7C3AED)
[![mods](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fstylusnexus%2Fclaude-mods%2Fmain%2F.claude-plugin%2Fmarketplace.json&query=%24.plugins.length&label=mods)](.claude-plugin/marketplace.json)
![Tested on Claude Code 2.1.296](https://img.shields.io/badge/tested_on-Claude_Code_2.1.296-555)
[![GitHub stars](https://img.shields.io/github/stars/stylusnexus/claude-mods)](https://github.com/stylusnexus/claude-mods/stargazers)

Small Claude Code mods from [Stylus Nexus](https://github.com/stylusnexus): a progress row above the prompt, a usage meter, a Render deploy light, and a checker for team conventions. Each mod is a few hundred lines of TypeScript with tests, so you can read one in a sitting before you install it.

A mod is a Claude Code plugin with a hooks module: it can add status lines, rows above the prompt, toasts, tools and commands.

> **Read before you install.** A mod runs inside your Claude Code session and sees your prompts, tool calls and answers. Review a mod's source first. The table says which mods touch the network or can block a command.

## Mods

| Mod | What it does | Network | Can block a command? |
| --- | --- | --- | --- |
| [`task-progress`](#task-progress) | One progress row per plan the model reports, plus a row per running subagent. | No | Only its own tool, on bad input |
| [`limits-meter`](#limits-meter) | 5-hour and weekly usage in the status line, plus running subagents. Toasts at 90% and 95%. | No | No |
| [`deploy-watch`](#deploy-watch) | A light per Render service in the status line, with a toast when a deploy starts, goes live, fails or is canceled. | Render API, read-only | No |
| [`house-rules`](#house-rules) | Warns when a goal-checklist strip breaks its rules. Optional: status-line check and a commit and PR title rule. | No | Only the title rule, and only if you turn it on |

## Install

```
/plugin marketplace add stylusnexus/claude-mods
/plugin install task-progress@stylusnexus-mods
```

Replace `task-progress` with any mod name above. Run `/plugin` to enable, disable or configure it later.

**Requires** a Claude Code build that loads hooks modules. These mods were built and tested on Claude Code 2.1.296. Check yours with `claude --version`.

## task-progress

A progress row above the prompt for each plan the model reports:

```
Ship login · Build · 2/6 steps · ▓▓▓░░░░░░░ 33% · running
↳ explorer · sonnet · Grep · 0:42
```

- **Plans:** the model creates a plan for any task of three or more steps, then updates it with short calls: `{id, next:true}`, `{id, done:[…], active:…}`, `{id, failed:…, note}`, `{id, state:…}`. An unknown step title is refused with the list of valid ones.
- **Subagents:** one row each, with name, model, current tool and elapsed time. They come from engine events and cost no tokens.
- **States:** running, needs input, error, done. A finished plan leaves after `doneBarSeconds` (default 30).
- **Commands:** `/progress [show|hide]` and `/progress-clear`.
- **Adds** one short section to the system prompt telling the model when to create and update a plan.
- **Does not:** make network calls, run shell commands, read or write files, block edits, or hold a turn open.

The bar shows what the model reports. A full bar is not proof the work is done; check the work.

Not yet verified: it has not run in a long live session, and a subagent's row leaves on that subagent's first finished turn, so a subagent with several turns may drop off early.

## limits-meter

Status line such as `5h 42% · wk 18% · 2 agents`. Toasts once when a window passes 90% and again at 95%, with the time until it resets. No options, no network.

## deploy-watch

Status line such as `deploy: api 🟢 · web 🟡`. A toast when a service's newest deploy starts, goes live, fails or is canceled.

| Option | Meaning |
| --- | --- |
| `renderApiKey` | A Render API key. The mod only lists deploys. Stored as a sensitive option. |
| `serviceIds` | Comma-separated Render service ids; label one with `name=id`, for example `api=srv-abc123,web=srv-def456`. |
| `pollSeconds` | How often to check, 10 to 600. Default 30. |

The only network calls are `GET https://api.render.com/v1/services/<id>/deploys?limit=1` with your key.

## house-rules

Built for one team's goal-checklist convention: rows of ⬜ 🔄 🟦 🚀 ✅ with a tally line, directly above a 🟢/🟡/🔴 status line. By default it only shows a toast when a printed strip breaks the rules (tally mismatch, skipped stage, merged item with no SHA, strip with nothing changed, strip when no checklist is active). Read [`strip.ts`](plugins/house-rules/hooks/strip.ts) before relying on it.

| Option | Default | Meaning |
| --- | --- | --- |
| `checkStatusLine` | off | Warn when a reply does not end on a 🟢/🟡/🔴 line of 100 characters or fewer. |
| `enforceCommitRule` | off | **Blocks** `git commit` and `gh pr create` unless the subject is `type(scope): summary`, 50 characters or fewer, lowercase after the colon, no trailing period. |

## Development

Each mod lives in `plugins/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/*.ts`. Pure logic sits in its own file with unit tests beside it; `register.ts` holds the hooks.

```
cd plugins/<name>
claude plugin test .
claude plugin validate .
```

There is no CI yet: the checks above need the Claude Code CLI and have not been wired into GitHub Actions.

## Contributing

Issues and pull requests are welcome. Keep a mod small, keep its tests passing, and say in the README table whether it uses the network or can block a command. Use `type(scope): summary` commit titles of 50 characters or fewer.

## License

[MIT](LICENSE) © 2026 Stylus Nexus
