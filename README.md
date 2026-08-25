# Cortex

Model-agnostic workflow orchestration for coding agents.

You write a JavaScript script that describes *how* work should be decomposed — what fans out,
what verifies, what synthesizes. Cortex runs it, and every `agent()` call in the script becomes
a headless invocation of whichever coding CLI you point it at: Claude Code, Codex, or Cursor.

The control flow is deterministic JavaScript. The judgment is delegated to agents. Neither one
is doing the other's job.

```bash
cortex run examples/review.workflow.js --adapter claude
```

## Install

No dependencies, no build step. Node 22.18+ runs the TypeScript sources directly.

```bash
git clone <this repo> && cd cortex && npm link
```

Or skip the link and call it directly:

```bash
node src/cli.ts run my.workflow.js
```

## Writing a workflow

A workflow is a plain `.js` file. It starts with a `meta` literal and then uses injected globals —
no imports, no module system.

```js
export const meta = {
  name: 'triage-issues',
  description: 'Classify open issues and draft a fix plan for the real bugs',
  phases: [{ title: 'Classify' }, { title: 'Plan' }],
};

const VERDICT = {
  type: 'object',
  required: ['kind', 'reason'],
  properties: {
    kind: { enum: ['bug', 'feature', 'noise'] },
    reason: { type: 'string' },
  },
};

phase('Classify');

const planned = await pipeline(
  args.issues,
  (issue) => agent(`Classify issue #${issue}.`, { label: `classify:${issue}`, schema: VERDICT }),
  (verdict, issue) =>
    verdict?.kind === 'bug'
      ? agent(`Draft a fix plan for issue #${issue}.`, { label: `plan:${issue}`, phase: 'Plan' })
      : null,
);

return planned.filter(Boolean);
```

```bash
cortex run triage.workflow.js --args '{"issues":[41,42,43]}'
```

### Injected globals

| Global | Behavior |
|---|---|
| `agent(prompt, opts?)` | Runs one headless agent. Returns its text, or a validated object when `opts.schema` is set. Returns `null` if every attempt fails. |
| `parallel(thunks)` | Runs thunks concurrently and waits for all of them. A thunk that throws resolves to `null` — the call itself never rejects. |
| `pipeline(items, ...stages)` | Runs each item through every stage independently, with **no barrier between stages**. Item A can be in stage 3 while item B is still in stage 1. Stages receive `(previous, originalItem, index)`. A throwing stage drops that item to `null`. |
| `phase(title)` | Groups subsequent agents under a heading in the progress output. |
| `log(message)` | Prints a progress line. |
| `args` | Whatever you passed to `--args`, verbatim. |

`agent()` options: `label`, `phase`, `schema`, `model`, `cwd`, `timeoutMs`, `retries`.

Reach for `parallel` only when a stage genuinely needs *all* of the previous stage's results at
once — deduping across a full result set, or bailing out when the total count is zero. Otherwise
`pipeline` finishes sooner for the same work.

### Structured output

Pass a JSON Schema as `opts.schema` and Cortex appends the schema to the prompt, extracts JSON
from whatever comes back (fenced, prose-wrapped, or bare), and validates it. On a mismatch it
retries with the validation errors fed back to the agent. The supported schema subset is `type`,
`properties`, `required`, `items`, `enum`, `additionalProperties: false`, `minimum`/`maximum`,
and `minItems`/`maxItems` — enough to shape an answer, not a full JSON Schema implementation.

## Backends

```
claude   claude         verified
codex    codex          verified
cursor   cursor-agent   verified
```

All three have been run end to end against a live backend. `claude` and `codex` take the prompt
on stdin; `cursor-agent` only accepts it as an argument, which matters on Windows (see below).

Anything after `--` is passed straight through to the backend CLI, which is how you tighten what
the agents are allowed to do:

```bash
cortex run flow.js --adapter claude -- --permission-mode acceptEdits --add-dir ../shared
cortex run flow.js --adapter codex  -- -s read-only
cortex run flow.js --adapter cursor -- --mode plan --trust
```

Note that passthrough applies to every agent in the run, not per `agent()` call — see
[Scoping agents](#scoping-agents) for the per-call bound. `cursor-agent` refuses to run in an
untrusted directory, so `--trust` (or an interactive session there first) is required.

`codex` also accepts `--output-schema`, but it demands OpenAI strict-mode schemas
(`additionalProperties: false` on every object, all properties required), so Cortex does not wire
it up — the prompt-plus-validate path works across all three backends with ordinary JSON Schema.

## Scoping agents

The failure mode this exists to stop isn't a security breach — it's an agent asked to make one
edit that goes off and reads every test, caller, and reference first. That's a *read* problem, so
a sandbox doesn't help: sandboxes gate writes and network. What helps is not having the files
there at all.

Give an `agent()` call a **cone** and Cortex runs it in a sparse worktree containing only those
paths:

```js
await agent('Add the missing null check', {
  cone: ['src/auth/session.ts'],
  profile: 'editor',
});
```

`cone` entries are repo-root-relative, gitignore-syntax patterns, so individual files and whole
directories both work. Everything outside the cone is absent from disk — the agent can't read
what isn't there. When the call finishes, its changes come back as a patch applied to the run
worktree and the agent worktree is destroyed. Two agents with disjoint cones can't see or clobber
each other's work.

Cones are the portable bound: sparse checkout behaves identically for `claude`, `codex`, and
`cursor`. `profile` is the per-backend layer on top — `'editor'` (read and write, no shell, no
subagents) or `'reader'` (read only), shipped as each backend's own native config rather than
flattened into a shared vocabulary. See [`profiles/README.md`](profiles/README.md).

Two honest limits. A profile narrows the *project* config layer only, so a permissive
`~/.claude/settings.json` still merges over it; the cone is the part that holds regardless. And
overlapping cones can make the patch conflict, which surfaces as a failed agent rather than an
automatic merge.

## Verification

Agents don't run tests. A model handed a red suite starts working through hypotheses, and that
churn is bounded by turns rather than by files — which is exactly the thing a cone can't
constrain. So checks run from the orchestrator:

```js
const check = await verify('npm test');
if (!check.ok) log('tests are red — stopping here');
```

`verify()` runs in the run worktree and resolves with `{ ok, code, output, durationMs }` — a red
check is data, not an exception. A run whose checks or agents failed comes out **red**: Cortex
prints the failing output plus a map of which agent changed which files, and stops. Nothing is
sent after the failure to try to fix it.

Because nothing inside an agent worktree ever executes, a cone only needs the files being
*edited* — not the files those files import.

| Exit code | Meaning |
|---|---|
| `0` | green — every agent and check passed |
| `1` | red — a check or an agent failed |
| `2` | usage error |
| `3` | cortex itself crashed |

### Windows shims

Agent CLIs install as `.cmd` shims on Windows, and `cmd.exe` silently truncates an argument at
its first newline — which would quietly cut every prompt down to its first line for any backend
that takes the prompt as an argument. When an argument spans lines, Cortex routes around
`cmd.exe` by invoking the shim's sibling `.ps1` through PowerShell instead. If a shim has no
`.ps1`, the run fails with an explicit error rather than sending a truncated prompt.

## CLI

```
cortex run <script.js> [options] [-- <args passed to the agent CLI>]
cortex adapters
```

| Option | Default | |
|---|---|---|
| `-a, --adapter <name>` | `claude` | Backend to invoke |
| `-m, --model <model>` | backend default | Passed through to the CLI |
| `-c, --concurrency <n>` | `cpus-2`, capped at 8 | Max agents in flight |
| `--args <json\|@file>` | — | Value exposed to the script as `args` |
| `--cwd <dir>` | `.` | Working directory for agents |
| `--timeout <seconds>` | `600` | Per-agent timeout |
| `--retries <n>` | `1` | Extra attempts per agent |
| `--journal <dir>` | `.cortex/runs` | Per-agent JSONL record |
| `--no-journal` | — | Disable the journal |
| `--dry-run` | — | Stub every agent; exercise control flow only |
| `-q, --quiet` | — | Progress off, JSON result on stdout |
| `--json` | — | Print the return value as JSON |

Exit code is `1` if any agent failed after its retries, `0` otherwise.

`--dry-run` costs nothing and calls no backend: schema-bearing agents get a stub generated from
their schema, and everything else gets placeholder text. Use it to check that a workflow's
control flow does what you meant before spending tokens on it.

## Design notes

**Workflow scripts are trusted code.** They run as an async function in the host realm with the
listed globals injected — `import` is rejected, but this is not a sandbox. Run scripts you wrote.

**No resume.** A run that dies is re-run from the top. The journal at `.cortex/runs/<id>/journal.jsonl`
records what each agent returned, which is enough to see what happened but not to replay it.

## Tests

```bash
npm test
```
