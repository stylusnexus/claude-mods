# Claude Code mods

Small Claude Code mods (plugins with a hooks module) from [Stylus Nexus](https://github.com/stylusnexus). MIT-licensed. Each mod is a few hundred lines with tests, makes no network calls except where noted, and blocks nothing it does not say it blocks.

Needs a Claude Code build that loads hooks modules (the mods API). Check with `claude --version` and `claude plugin validate`.

## Install

```
/plugin marketplace add stylusnexus/claude-mods
/plugin install task-progress@stylusnexus-mods
```

Swap in any name from the table.

| Mod | What it does | Network | Blocks anything? |
| --- | --- | --- | --- |
| [task-progress](plugins/task-progress) | One progress row per plan the model reports, plus a row per running subagent, above the prompt. The bar shows what the model reports, so it is not proof the work is done. | No | Only its own tool, on bad input |
| [limits-meter](plugins/limits-meter) | Status line shows 5-hour and weekly usage and running subagents. Toasts at 90% and 95%. | No | No |
| [deploy-watch](plugins/deploy-watch) | Status light for Render deploys, with a toast on start, live, fail or cancel. Needs a Render API key and service ids (set in the plugin options). | Render API, read-only | No |
| [house-rules](plugins/house-rules) | Warns when a goal-checklist strip breaks its rules. Options, both off by default: check the closing status line; block `git commit` and `gh pr create` unless the title is `type(scope): summary`, 50 characters or fewer. | No | Only the commit and PR title rule, when you turn it on |

`house-rules` follows one team's goal-checklist convention (⬜ 🔄 🟦 🚀 ✅ rows with a tally line). Read `plugins/house-rules/hooks/strip.ts` before relying on it.

## Status

`task-progress` passes its tests but has not been run in a long live session. A subagent's row leaves on that subagent's first finished turn, so a subagent with several turns may drop off early.

## Tests

From a mod's folder: `claude plugin test .` and `claude plugin validate .`

## License

MIT. See [LICENSE](LICENSE).
