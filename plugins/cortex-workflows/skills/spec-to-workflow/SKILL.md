---
name: spec-to-workflow
description: Turn a spec (a description of an outcome and its scope) into an executable Cortex .workflow.js file — designs the fan-out, assigns a fast or capable model per task, scopes every agent() call to a cone of the files it may touch, and skips agent() entirely for purely mechanical steps. Use whenever the user has a spec or requirements doc and asks to "turn this into a workflow," "cortex-ify this," "make a workflow for this spec," or wants Cortex to execute a piece of work — even if they don't name Cortex explicitly but describe applying the same change across many files, modules, or endpoints. Trigger only when the Cortex CLI is available to run the generated workflow; this targets Cortex's agent/parallel/pipeline globals, not Anthropic's Workflow tool.
---

# Spec to Workflow

Cortex's whole premise is that control flow belongs in deterministic JavaScript and
judgment belongs in agents — neither one does the other's job. Your
job here is to read a spec and make that split for it: decide what fans out, what runs
in parallel, what's genuinely sequential, and what needs no judgment at all — then
write the `.workflow.js` file that encodes those decisions.

## Start from a spec, not a plan

If what you've been handed is a numbered plan ("1. do X, 2. do Y, 3. do Z"), that
numbering is usually an artifact of whoever wrote it thinking about how *they* would
execute it by hand — one thing after another. That's exactly the structure Cortex
exists to undo. Don't transcribe the plan's steps into a chain of `agent()` calls in
the same order; read through the numbering for the actual shape of the work — the same
kind of edit repeated across a list of targets, several independent checks against one
target, a real dependency where step 2 needs step 1's output. Design the workflow
around that shape.

A spec (a description of the desired end state and its scope, without a committed
execution order) makes this easier because there's no flattening to undo — but plans
show up too, and the same read applies either way.

## Find the shape before you write any code

Work through the spec and sort what you find into four buckets. Most specs are a mix.

1. **A repeating unit.** Phrases like "each of," "every," "all N files/endpoints/
   modules," or an implied list (twelve routes need the same validation added) — this
   is a `pipeline()` over an item array, not N separate agent calls written out by
   hand. If the item list isn't given explicitly, it's fine for the workflow to derive
   it at runtime (e.g. via `args`) rather than hardcoding it into the script.
2. **Independent dimensions on one target.** Several unrelated checks or changes
   against the same thing (review for correctness *and* security *and* style) — these
   run concurrently via `parallel()`, not one after another.
3. **Genuine sequence.** Step B needs step A's actual output to know what to do
   (verify a finding, then fix only the ones that were real). This is a `pipeline`
   stage chain, or plain sequential `await`s — not something to parallelize away.
4. **No judgment required at all.** Renaming a file, running one fixed script, copying
   a template, moving something from A to B. See "Skip the agent" below — these don't
   belong in `agent()` calls.

## Assign a model per task, not per run

Cortex has no built-in model-tier concept — `PhaseMeta.model` in the type definitions
is declared but never actually read anywhere in the runtime, so setting it accomplishes
nothing. The only place a model choice takes effect is the `model` field in a specific
`agent()` call's options, or the `-m/--model` flag applied to the whole run as a
fallback.

Use that per-call field deliberately. Declare two named constants near the top of the
generated workflow:

```js
const FAST_MODEL = 'TODO: fill in the current fast/cheap model for your adapter';
const CAPABLE_MODEL = undefined; // omit `model` on capable-tier calls to inherit the run's --model
```

Set `opts.model = FAST_MODEL` on calls that are narrow, well-specified, and low-ambiguity
— a single mechanical-but-not-quite-scriptable edit, a simple rename with light
judgment, formatting a known shape into another known shape. Leave `model` unset
(inheriting whatever `--model`/adapter default the run is invoked with) for anything
that involves architecture, cross-file reasoning, ambiguity, or judgment calls close to
what a verification pass would need to check — that's the run's capable-tier default,
not something this workflow should second-guess.

Never hardcode a specific model ID/version yourself — they go stale fast and you don't
know what's current. If the user names a model in the spec or conversation, use it
verbatim. Otherwise leave the `TODO` in `FAST_MODEL` and say so plainly when you hand
the file back — don't silently guess a model name.

## Give every agent() call a cone

`cone` is a list of repo-root-relative, gitignore-syntax paths in an `agent()` call's
options. Cortex builds that call a throwaway git worktree — `git worktree add
--no-checkout --detach` plus `git sparse-checkout set --no-cone <patterns>` — so every
file outside the cone is *physically absent from disk* while the agent runs. Its
changes come back as a pathspec-limited `git diff --cached` patch applied into the run
worktree, and the agent worktree is destroyed.

The problem this solves is scope sprawl, not security. The failure mode worth designing
against is an agent asked to make one small edit that wanders off to read every test,
every caller, and half the adjacent module — burning context and drifting from the
task. Sprawl is a *read* problem, which is why a sandbox wouldn't help (sandboxes gate
writes) and a sparse cone does: there is nothing left to wander into.

So pick the narrowest set of paths the task actually **edits**:

```js
await agent('Add request-id logging to the auth middleware.', {
  cone: ['src/middleware/auth.ts'],
  profile: 'editor',
});
```

Getting a cone slightly wrong is a cheap mistake, and that's the point. An
under-specified cone fails *loudly* — the agent reports a file it can't find, at a
specific path, in a specific call — rather than silently over-reaching and leaving you
to spot it in the diff later. Prefer erring narrow and widening on a real failure over
padding the cone "just in case," because padding recreates exactly the sprawl the cone
exists to prevent.

When a call has a `cone`, the backend runs in the agent worktree, so that call's `cwd`
no longer decides what it can see. Keep prompt-level scoping — naming the in-scope
files, saying not to touch anything else — as a courtesy that helps the agent orient
and produces better first attempts. It just isn't the mechanism any more, so it doesn't
need the belt-and-braces phrasing it used to carry.

Two honest limits to carry into what you hand back:

- Cones are the only *portable* bound. Sparse checkout behaves identically across the
  claude, codex, and cursor adapters.
- Overlapping cones can make the returned patches conflict on `git apply`. That surfaces
  as an agent failure (and a red run), never as a silent auto-merge. If two calls in
  your fan-out genuinely edit the same file, sequence them instead of running them
  concurrently.

## Choose a profile: 'editor' or 'reader'

`profile` applies a pre-rolled native config through a throwaway backend config root.
`editor` allows focused file editing without shell or subagents. `reader` is read-only.

Pick `reader` for any call that only produces a judgment — reviews, audits, classifying
findings, deciding which items need work — and `editor` for calls that change files. If
which one applies isn't obvious from the prompt text alone, state it explicitly rather
than leaving it to the default.

Profiles are deliberately *not* portable the way cones are: each is authored in its
provider's vocabulary rather than flattened behind a shared `allowedTools` abstraction.
Cortex replaces the backend's normal settings root for the call and seeds only the
authentication material needed to invoke that backend.

## Never let an agent run tests

Verification is the orchestrator's job, expressed as a `verify()` step that runs in the
run worktree:

```js
const check = await verify('npm test');
if (!check.ok) log('tests are red — stopping here');
```

`verify()` doesn't throw on failure; a red check is data, so the workflow decides what
to do with it. A red run is *reported, never repaired* — nothing feeds a test failure
back into an agent, because a run ends `green` or `red` and the report is the handoff
artifact. Debugging is left out of this automation on purpose: hypothesis churn is
bounded in time rather than in space, so it doesn't decompose into cones the way editing
does, and it's work a human does better by hand.

This has a useful consequence for cone sizing. Because nothing inside an agent worktree
ever *executes*, cones can be **edit-sized rather than build-sized** — you do not need
to include the files that the edited files import, the tests that cover them, or
anything else that would only matter to a compiler or a test runner. Only what the agent
reads and writes.

## Skip the agent when there's nothing to judge

Before writing an `agent()` call, ask whether this step could be "wrong" in any way an
LLM would need to catch. If the answer is no — it's a rename, a move, running one fixed
command, copying a template — don't spend a call on it. Workflow scripts run as trusted
code in the host process, not a sandbox; the only thing
actually blocked is a static `import` statement, so a dynamic `await import(...)` of a
Node builtin works fine for real file/process operations:

```js
phase('Rename');
const { rename } = await import('node:fs/promises');
await rename('old/path.ts', 'new/path.ts');
log('renamed old/path.ts -> new/path.ts');
```

This costs no tokens and can't misjudge anything, because there's no judgment in it.
Reserve `agent()` for the steps where a model actually has to decide something.

## Prefer pipeline; reach for parallel only as a real barrier

Default to `pipeline(items, ...stages)` for the repeating-unit case — it starts every
item immediately and each one moves through its own stages independently, so the whole
run finishes in roughly the time of the slowest single item's chain, not the sum of
per-stage worst cases. Use `parallel()` only when a later step genuinely needs *every*
prior result at once before it can proceed — deduplicating findings across the whole
set, or bailing out early because the total count came back zero. If you catch yourself
writing `parallel()` immediately followed by a `.map()`/`.flat()` with no real
cross-item dependency, that's pipeline: put the transform inside a pipeline stage
instead. Don't unroll a repeating unit into N separate hand-written `agent()` calls —
that's the exact structure `pipeline` exists to replace, and it stops scaling the
moment the list size isn't known when you're writing the workflow.

## What the finished file should always have

- `meta.phases` that actually match the `phase()` calls used in the body — don't leave
  stale or aspirational phase names.
- The `FAST_MODEL`/`CAPABLE_MODEL` constants near the top, per "Assign a model" above.
- A `cone` on **every** `agent()` call — no call is so small it doesn't deserve one, and
  a call without a cone falls back to the whole run worktree.
- A `profile` wherever the read/write split isn't self-evident from the prompt.
- A closing `verify()` wherever the spec implies a check ("tests should still pass,"
  "the build must be clean," "lint stays green"), with the workflow's `return`
  reflecting whether it came back ok.
- A `return` at the end that summarizes what happened in a shape a human can skim —
  filter down to confirmed findings rather than returning every intermediate value.

Before handing the file back, validate it for free:

```bash
cortex run <file> --dry-run --json
```

`--dry-run` calls no backend at all — schema-bearing agents get a stub generated from
their schema, everything else gets placeholder text, and no agent worktrees are created
— so this only checks that the control flow runs without throwing and returns the shape
you expect. It costs nothing in tokens, so there's no reason to skip it. If it fails,
fix the workflow before handing it back; don't hand back a script you haven't dry-run.

One caveat: `--dry-run` only stubs `agent()` calls. Any plain JS you wrote for a
mechanical step under "Skip the agent" — a real `fs.rename`, a real `child_process`
call — is not an agent call, so it executes for real even in a dry run. That's usually
fine (the whole point of that step was that it's safe, deterministic, and doesn't need
judgment), but it means dry-run validation isn't a consequence-free sandbox once
mechanical steps are in the file. Say so when you hand the file back if it contains any.

Finish by telling the user: the file path, the dry-run result, the recommended real
`cortex run` invocation, and any place you left a `FAST_MODEL` TODO, guessed at a cone
you weren't confident about, or found two calls whose cones overlap. Mention that the
run exits `0` when green, `1` when red (a failing check or a failing agent), `2` on a
usage error, and `3` on a crash — so a `1` reads as "go look at the report," not as
Cortex breaking.
