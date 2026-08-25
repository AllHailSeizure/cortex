# Permission profiles

Each profile is a directory of **native** backend config. Cortex copies the subdirectory
matching the run's adapter into an agent worktree root before launching the CLI there, so the
restriction is expressed in that backend's own vocabulary instead of being flattened into a
shared `allowedTools` field that would mean something different to each one.

| Profile | Intent |
|---|---|
| `editor` | Read and write files inside the cone. No shell, no subagents, no network. |
| `reader` | Inspect the cone and report back. No writes. |

Neither profile permits running commands. Verification is the orchestrator's job — see `verify()`
in the workflow runtime — so an agent never needs to execute anything.

## Known limits

- **A profile narrows the project layer only.** Claude merges a user-level
  `~/.claude/settings.json` over the project config, so on a machine with a permissive global
  config a profile is not the final word. Cones are the bound that holds regardless.
- **The `cursor` configs are unverified.** `claude` and `codex` profiles were written against
  documented config keys; the `.cursor/cli.json` shape is a best-effort guess and has not been
  exercised against a live `cursor-agent`. Check it before relying on it.
