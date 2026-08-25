# Permission profiles

Each profile is a directory of **native** backend config. Cortex builds a throwaway config root
per agent, drops the profile's file in, and points the backend at it with that backend's own
environment variable — so the restriction is expressed in the backend's own vocabulary instead
of being flattened into a shared `allowedTools` field that would mean something different to
each one.

| Profile | Intent |
|---|---|
| `editor` | Read and write files inside the cone. No shell, no subagents, no network. |
| `reader` | Inspect the cone and report back. No writes. |

Neither profile permits running commands. Verification is the orchestrator's job — see `verify()`
in the workflow runtime — so an agent never needs to execute anything.

## How a profile is applied

| Backend | Environment variable | Settings file | Auth seeded |
|---|---|---|---|
| `claude` | `CLAUDE_CONFIG_DIR` | `settings.json` | `.credentials.json` |
| `codex` | `CODEX_HOME` | `config.toml` | `auth.json` |
| `cursor` | `CURSOR_CONFIG_DIR` | `cli-config.json` | `agent-cli-state.json` |

Relocating the whole config root is what makes a profile authoritative. A project-level config
file is *merged under* the user's own settings and can be widened by them; replacing the root
removes that layer entirely.

The catch is that these roots hold credentials as well as settings, so a freshly-made one starts
logged out. Cortex seeds the auth file across explicitly rather than copying the whole root — the
point of a profile is what the agent *doesn't* have, and a bulk copy would drag the user's
skills, MCP servers, and subagents in by default.

## Known limits

- **The `cursor` config is only partly verified.** Checked against `cursor-agent` 2026.08.11:
  `CURSOR_CONFIG_DIR` is read in the same function that resolves `cli-config.json`, falling back
  to `$XDG_CONFIG_HOME/cursor` then `~/.cursor`. What is *not* verified is the tool-identifier
  vocabulary — an unknown name like `Banana(**)` passes schema validation silently, so a wrong
  identifier is a no-op rather than an error. `Shell(...)` is confirmed real; `Write(...)` and
  `Mcp(...)` appear in the binary but have not been observed blocking a call. The profiles
  therefore state restrictions as `deny` entries only: a `deny` that silently fails is no worse
  than the default, whereas a bogus `allow` could read as permission that was never granted.
- **The `codex` config is unverified** — written against documented keys, but `codex` was not on
  PATH to check them.
