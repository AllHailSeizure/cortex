# Agent Cones Implementation Plan

**Goal:** Bound each `agent()` call to a sparse-checkout worktree containing only the files it needs, run all verification from the orchestrator instead of from agents, and report a red status with a per-agent change map rather than attempting automated repair.

**Architecture:** A run still gets one full worktree (unchanged). Each `agent()` call with a `cone` gets its own throwaway worktree created with `git worktree add --no-checkout --detach` plus `git sparse-checkout set --no-cone <patterns>`, so files outside the cone are physically absent from disk. A pre-rolled permission profile for the active adapter is copied into that worktree root before the CLI launches there. When the agent finishes, its changes are captured as a pathspec-limited patch, applied into the run worktree, and the agent worktree is removed. Verification runs as a `verify()` step in the run worktree, never inside an agent; a failing check makes the run red without failing it, and the reporter prints which agent changed which files.

**Tech Stack:** Node ≥22.18 with native TypeScript, `node --test`, git ≥2.25 (sparse-checkout), no runtime dependencies.

## Global Constraints

- **Agents never run tests.** Profiles must deny command execution where the backend can express it, and every generated prompt must say so. Verification is the orchestrator's job.
- **No automated repair.** A failing check produces a red report and stops. Nothing feeds a test failure back into an agent.
- **Cones are the only portable bound.** Sparse checkout works identically across claude/codex/cursor. Profiles are per-provider and explicitly lossy; do not invent a shared `allowedTools` abstraction over them.
- **Mechanical steps skip `agent()`.** Unchanged from current guidance.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`.
- Windows is a first-class target. Use `runProcess` (which handles `.cmd` shims), never bare `spawn` with shell interpolation of paths.
- Cone patterns are POSIX-style, relative to the repo root, gitignore-syntax (non-cone mode) so individual files and directories both work.

---

## File map

| File | Responsibility |
|---|---|
| `src/worktree.ts` (modify) | Add `createAgentWorktree`, `captureAgentPatch`, `applyPatch`, `removeAgentWorktree` alongside existing run-worktree code |
| `src/profiles.ts` (create) | Resolve a named profile to its per-adapter config files and copy them into a worktree root |
| `profiles/editor/`, `profiles/reader/` (create) | The pre-rolled `.claude/settings.local.json`, `.codex/config.toml`, `.cursor/cli.json` payloads |
| `src/types.ts` (modify) | `cone`/`profile` on `AgentOptions` and `AgentRequest`; `CheckResult`; `RunStatus`; `changedFiles` on `AgentResult` |
| `src/runtime.ts` (modify) | Thread `cone`/`profile` into requests; add the `verify()` global; record `changedFiles` |
| `src/run.ts` (modify) | Per-agent worktree lifecycle around `execute`; run checks; compute `RunSummary.status` |
| `src/reporter.ts` (modify) | Red report: failing check output + agent→changed-files map |
| `src/cli.ts` (modify) | Exit codes (0 green / 1 red / 2 usage / 3 crashed); help text |
| `README.md` (modify) | Replace the "passthrough is your only lever" framing with cones + profiles |
| `.claude/skills/spec-to-workflow/SKILL.md` (modify) | Rewrite the scoping section; add verification-is-not-the-agent's-job guidance |
| `test/worktree.test.ts`, `test/profiles.test.ts`, `test/runtime.test.ts`, `test/run.test.ts` | Coverage per task |

---

### Task 1: Sparse agent worktrees in `worktree.ts`

**Files:**
- Modify: `src/worktree.ts`
- Test: `test/worktree.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AgentWorktree = { path: string; cone: string[] };
  export function createAgentWorktree(runWorktreePath: string, id: number, cone: string[]): Promise<AgentWorktree>;
  export function captureAgentPatch(worktree: AgentWorktree): Promise<{ patch: string; files: string[] }>;
  export function applyPatch(targetPath: string, patch: string): Promise<void>;
  export function removeAgentWorktree(runWorktreePath: string, worktree: AgentWorktree): Promise<void>;
  ```

Agent worktrees live at `<runWorktreePath>/.cortex/worktrees/agents/<id>`, which is already covered by the repo's `.cortex/worktrees/` gitignore entry.

- [ ] Step: write failing tests in `test/worktree.test.ts` using the existing `initRepo()` helper, extended to create `src/a.ts`, `src/b.ts`, `test/a.test.ts`:
  - `createAgentWorktree` with cone `['src/a.ts']` puts only `src/a.ts` on disk (assert `existsSync` true for it, false for `src/b.ts` and `test/a.test.ts`)
  - `captureAgentPatch` after editing `src/a.ts` returns a patch containing `+export const a = 99;` and `files` equal to `['src/a.ts']`
  - `captureAgentPatch` picks up a *new* file created inside a directory cone (`['src/']`, agent writes `src/c.ts`)
  - `captureAgentPatch` returns `files: []` and an empty patch when the agent changed nothing
  - `applyPatch` applies that patch into the run worktree and leaves `src/b.ts` untouched
  - `removeAgentWorktree` deletes the directory and leaves no `git worktree list` entry
- [ ] Step: `npm test` — expect failures: `createAgentWorktree is not a function`
- [ ] Step: implement. `createAgentWorktree` runs, via `runProcess('git', ...)` with `cwd: runWorktreePath`:
  ```
  worktree add --no-checkout --detach <path> HEAD
  ```
  then in the new worktree: `sparse-checkout set --no-cone -- <...cone>` and `checkout`. Throw with git's stderr if any step exits non-zero. `captureAgentPatch` runs `add -A -- <...cone>`, then `diff --cached HEAD -- <...cone>` for the patch and `diff --cached --name-only HEAD -- <...cone>` for the file list — the pathspec limit is what keeps sparse-excluded files from being staged as deletions. `applyPatch` writes the patch to a temp file and runs `git apply` in `targetPath`, throwing with stderr on failure (a conflict is a reportable event, not a crash). `removeAgentWorktree` runs `worktree remove --force <path>`, ignoring errors, then `rmSync(path, { recursive: true, force: true })`.
- [ ] Step: `npm test` — expect pass
- [ ] Step: commit `feat: create sparse per-agent worktrees and capture their patches`

---

### Task 2: Permission profiles

**Files:**
- Create: `src/profiles.ts`
- Create: `profiles/editor/.claude/settings.local.json`, `profiles/editor/.codex/config.toml`, `profiles/editor/.cursor/cli.json`
- Create: `profiles/reader/.claude/settings.local.json`, `profiles/reader/.codex/config.toml`, `profiles/reader/.cursor/cli.json`
- Test: `test/profiles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROFILES: readonly string[]; // ['editor', 'reader']
  export function applyProfile(worktreePath: string, profile: string, adapter: string): void;
  ```

`editor` allows reading and writing files and nothing else — no shell, no web, no subagents. `reader` allows reading only. Concretely, `profiles/editor/.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Edit", "Write"],
    "deny": ["Bash", "Task", "WebFetch", "WebSearch", "NotebookEdit"],
    "defaultMode": "acceptEdits"
  }
}
```

`profiles/reader/.claude/settings.local.json` narrows `allow` to `["Read", "Glob"]` and adds `Edit`/`Write` to `deny`. `profiles/editor/.codex/config.toml` sets `sandbox_mode = "workspace-write"` and `approval_policy = "never"`; `reader` sets `sandbox_mode = "read-only"`. `profiles/*/.cursor/cli.json` sets the equivalent permission block for `cursor-agent`.

- [ ] Step: write failing tests in `test/profiles.test.ts`:
  - `applyProfile(dir, 'editor', 'claude')` creates `dir/.claude/settings.local.json` whose parsed `permissions.deny` includes `Bash`
  - `applyProfile(dir, 'editor', 'codex')` creates `dir/.codex/config.toml` and does *not* create `dir/.claude`
  - `applyProfile(dir, 'reader', 'claude')` denies `Write`
  - `applyProfile(dir, 'nope', 'claude')` throws `/unknown profile "nope"/` naming the available profiles
- [ ] Step: `npm test` — expect failure: cannot find module `../src/profiles.ts`
- [ ] Step: write the profile files, then implement `applyProfile` to resolve `profiles/<profile>/<adapterConfigDir>` relative to the package root via `new URL('../profiles/', import.meta.url)` and copy it into `worktreePath` with `cpSync(..., { recursive: true })`. Map adapter name → config dir: `claude → .claude`, `codex → .codex`, `cursor → .cursor`.
- [ ] Step: `npm test` — expect pass
- [ ] Step: add `"profiles"` to the `files` array in `package.json` so profiles ship with the package
- [ ] Step: commit `feat: add editor and reader permission profiles per adapter`

---

### Task 3: Wire `cone` and `profile` through the runtime

**Files:**
- Modify: `src/types.ts`, `src/runtime.ts`, `src/run.ts`
- Test: `test/runtime.test.ts`, `test/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `AgentOptions.cone?: string[]`, `AgentOptions.profile?: string`, the same two fields on `AgentRequest`, and `AgentResult.changedFiles?: string[]`.

`run.ts` wraps its existing `execute` so that when `request.cone` is set and the run has a worktree and it is not a dry run, it creates an agent worktree, applies the profile, points the backend at that path instead of `request.cwd`, captures the patch, applies it to the run worktree, and removes the agent worktree in a `finally`. Without a `cone`, behavior is exactly as it is today.

- [ ] Step: write failing tests:
  - `test/runtime.test.ts`: an `agent()` call with `{ cone: ['src/a.ts'], profile: 'editor' }` produces a request carrying both fields (assert via a stub `execute` that records its argument)
  - `test/runtime.test.ts`: `cone` defaults to `undefined` and the request still carries `cwd` as before
  - `test/run.test.ts`: a real end-to-end run in a temp repo with `dryRun: true` and a cone does *not* create any agent worktree (dry runs stay free)
  - `test/run.test.ts`: with a fake adapter whose `execute` writes to a file inside the cone, the edit lands in the run worktree and `result.changedFiles` equals the edited path
- [ ] Step: `npm test` — expect failures on the missing fields
- [ ] Step: implement. In `runtime.ts` add `cone: options.cone` and `profile: options.profile` to the `AgentRequest` literal, and set `result.changedFiles` from what `execute` reports back. In `run.ts`, wrap the non-dry-run `execute` in `withAgentWorktree(request, fn)` that performs the lifecycle above and returns both the adapter output and the changed file list.
- [ ] Step: `npm test` — expect pass
- [ ] Step: commit `feat: scope agent calls to sparse cones with a permission profile`

---

### Task 4: `verify()` — orchestrator-run checks

**Files:**
- Modify: `src/types.ts`, `src/runtime.ts`, `src/run.ts`
- Test: `test/runtime.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CheckResult = { command: string; ok: boolean; code: number | null; output: string; durationMs: number };
  ```
  and a `verify(command: string, opts?: { timeoutMs?: number }): Promise<CheckResult>` global available to workflow scripts.

`verify()` runs the command with `runShellCommand` in the **run worktree** (never an agent worktree), records the result on `runtime.checks`, and resolves with it. It never throws on a non-zero exit — a red check is data, not an exception, so the workflow can decide whether to keep going.

- [ ] Step: write failing tests in `test/runtime.test.ts`:
  - `verify('node -e "process.exit(0)"')` resolves `{ ok: true, code: 0 }` and pushes one entry onto `runtime.checks`
  - `verify('node -e "process.stderr.write(\'boom\'); process.exit(1)"')` resolves `{ ok: false, code: 1 }` with `boom` in `output` and does **not** reject
  - the reporter is told about the check (assert a `check` call on a stub reporter)
- [ ] Step: `npm test` — expect failure: `verify is not defined`
- [ ] Step: implement `verify` in `createRuntime`, add it to `globals`, expose `checks` on the `Runtime`, and add a `check(result: CheckResult)` method to the `Reporter` type printing `✓`/`✗ <command>`.
- [ ] Step: `npm test` — expect pass
- [ ] Step: commit `feat: add verify() so checks run in the orchestrator, not in agents`

---

### Task 5: Red status, exit codes, and the handoff report

**Files:**
- Modify: `src/run.ts`, `src/reporter.ts`, `src/cli.ts`, `src/types.ts`
- Test: `test/run.test.ts`

**Interfaces:**
- Produces: `RunStatus = 'green' | 'red'` and `RunSummary.status`, `RunSummary.checks`.

Status is `red` when any check failed **or** any agent failed; otherwise `green`. A crash still propagates as a thrown error out of `runWorkflow` and is caught in `cli.ts`. Exit codes: `0` green, `1` red, `2` usage error, `3` crashed — so a wrapper can tell a real breakage from a lost worktree.

Because there is no automated repair, the report is the handoff artifact. On red the reporter prints each failing check's command and output verbatim, then a map of every agent's label to the files it changed, so the human can see who touched what without reconstructing it.

- [ ] Step: write failing tests in `test/run.test.ts`:
  - a run whose `verify()` fails returns `status: 'red'` and still returns the workflow's value (no throw)
  - a run whose agents all succeed with no checks returns `status: 'green'`
  - a run with a failing agent returns `status: 'red'`
- [ ] Step: `npm test` — expect failure: `status` is undefined
- [ ] Step: implement `status` in `runWorkflow`'s return, add `Reporter.redReport(checks, results)` called from `runWorkflow` when status is red, and change `cli.ts`'s return to `summary.status === 'red' ? 1 : 0` with the top-level `.catch` setting `process.exitCode = 3`.
- [ ] Step: `npm test` — expect pass
- [ ] Step: commit `feat: report red runs with a per-agent change map instead of repairing`

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `src/cli.ts` (the `HELP` string)

- [ ] Step: in `README.md`, replace the "Note that passthrough applies to every agent in the run, not per `agent()` call" paragraph with a **Scoping agents** section covering: `cone` as the portable bound (sparse checkout, files outside are absent from disk), `profile` as the per-provider permission layer, and the honest limitation that a user-level config (`~/.claude/settings.json`) still merges on top of a profile, so a profile narrows the project layer only.
- [ ] Step: document that agents never run tests and `verify()` is how checks happen, with a short example:
  ```js
  const check = await verify('npm test');
  if (!check.ok) log('tests are red — stopping here');
  ```
- [ ] Step: document the exit codes (0/1/2/3) in the CLI help and README.
- [ ] Step: `node src/cli.ts --help` — confirm the new text renders
- [ ] Step: commit `docs: document cones, profiles, verify(), and exit codes`

---

### Task 7: Update the `spec-to-workflow` skill

> **Out of scope for this plan's execution.** Being handled in a separate session via
> `skill-creator`. Do not implement this task here; the steps below stay as the record of
> what that session needs to cover.

**Files:**
- Modify: `.claude/skills/spec-to-workflow/SKILL.md`

The skill currently tells the author that "Cortex has no per-call sandbox," that prompt text is "the only enforcement this architecture gives you," and that real restriction is a run-wide `--` passthrough. All three statements become false with Tasks 1–5, so the section must be rewritten rather than appended to.

- [ ] Step: rewrite "Scope every agent() call to its narrowest subfolder" as **Give every agent() call a cone**: pick the narrowest set of paths the task actually edits; `cone` is enforced by the filesystem, so an under-specified cone fails as a missing file rather than as silent over-reach; keep prompt-level scoping as a courtesy, not the mechanism.
- [ ] Step: add a paragraph on choosing `profile: 'editor'` vs `'reader'`, and note that a profile narrows the project config layer only.
- [ ] Step: delete the paragraph recommending `-- --permission-mode acceptEdits --add-dir <dir>` and the "split into separate workflow files or separate runs" workaround for per-phase restrictions — per-call cones and profiles remove that constraint entirely.
- [ ] Step: add a **Never let an agent run tests** section: verification belongs in `verify()`, a red check is reported and not repaired, and cones can therefore be edit-sized rather than build-sized because nothing inside an agent worktree executes.
- [ ] Step: update the `description` frontmatter so the trigger text mentions scoping each call to a cone rather than "to its narrowest subfolder."
- [ ] Step: update "What the finished file should always have" to require a `cone` on every `agent()` call and a closing `verify()` where the spec implies a check.
- [ ] Step: commit `docs: teach spec-to-workflow about cones, profiles, and verify()`

---

## Self-review

1. **Every requirement maps to a task?** Cones → 1, 3. Profiles → 2. Orchestrator-run tests → 4. Red status and report → 5. Docs → 6. Skill → 7. Yes.
2. **No placeholder language?** Each step names concrete files, commands, and expected failures. Profile JSON is spelled out rather than described.
3. **Types consistent across tasks?** `AgentWorktree`, `CheckResult`, `RunStatus`, and `changedFiles` are declared once and referenced by the same names downstream.

## Known limitations (carry into the docs, do not silently absorb)

- A user-level `~/.claude/settings.json` merges over a profile; the profile is not authoritative for a user whose global config is permissive.
- Per-agent worktree creation costs a `git worktree add` plus a checkout per call — noticeable on Windows for large fan-outs.
- `git apply` can conflict when two cones overlap. This is reported as an agent failure (making the run red), never auto-merged.
