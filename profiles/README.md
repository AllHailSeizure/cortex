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
- **The `cursor` configs are only partly verified.** Checked against `cursor-agent`
  2026.08.11: the project-level path `.cursor/cli.json` is real, and its schema accepts *only*
  `permissions.allow` and `permissions.deny`, both required — `approvalMode`, `sandbox`, and
  `model` are user-level keys and are rejected outright in a project config. Both profiles here
  pass that validation. What is *not* verified is the tool-identifier vocabulary: an unknown
  name like `Banana(**)` passes schema validation silently, so a wrong identifier is a no-op
  rather than an error. `Shell(...)` is confirmed real; `Write(...)` and `Mcp(...)` appear in
  the binary but have not been observed actually blocking a call. The profiles therefore state
  restrictions as `deny` entries only, since a `deny` that silently fails is no worse than the
  default, whereas a bogus `allow` could read as permission that was never granted.
- **The `codex` configs are unverified** — written against documented keys, but `codex` was not
  on PATH to check them.
