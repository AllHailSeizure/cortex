import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getAdapter } from './adapters/index.ts';
import { loadConfig } from './config.ts';
import { runProcess, resolveBinary } from './exec.ts';
import { createReporter } from './reporter.ts';
import { createRuntime, type ExecuteFn } from './runtime.ts';
import { runInAgentWorktree } from './scope.ts';
import { loadWorkflow } from './script.ts';
import { stubForSchema } from './stub.ts';
import type {
  AgentRequest,
  AgentResult,
  CheckResult,
  RunOptions,
  RunStatus,
  WorkflowMeta,
} from './types.ts';
import { createWorktree, runWorktreeSetup, type Worktree } from './worktree.ts';

export type RunSummary = {
  runId: string;
  meta: WorkflowMeta | undefined;
  value: unknown;
  results: AgentResult[];
  checks: CheckResult[];
  status: RunStatus;
  durationMs: number;
  worktree?: Worktree;
};

export async function runWorkflow(
  options: RunOptions,
  passthroughArgs: string[] = [],
): Promise<RunSummary> {
  const adapter = getAdapter(options.adapter);
  if (!options.dryRun && !resolveBinary(adapter.binary)) {
    throw new Error(`adapter "${adapter.name}" needs "${adapter.binary}" on PATH, but it was not found`);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const journalPath = options.journalDir
    ? join(resolve(options.journalDir), runId, 'journal.jsonl')
    : null;
  if (journalPath) mkdirSync(join(resolve(options.journalDir!), runId), { recursive: true });

  const reporter = createReporter(options.quiet);
  const startedAt = Date.now();

  const config = loadConfig(options.cwd);
  const worktreeEnabled = options.worktree ?? config.worktree ?? true;

  let effectiveCwd = options.cwd;
  let worktree: Worktree | undefined;

  if (worktreeEnabled) {
    worktree = await createWorktree(options.cwd, options.scriptPath);
    effectiveCwd = worktree.root;
    if (config.worktreeSetup) {
      reporter.log(`worktree setup: ${config.worktreeSetup}`);
      await runWorktreeSetup(config.worktreeSetup, worktree.path);
    }
  }

  const callBackend = async (request: AgentRequest, cwd: string): Promise<string> => {
    const invocation = adapter.build({ ...request, cwd }, passthroughArgs);
    const outcome = await runProcess(invocation.command, invocation.args, {
      cwd,
      stdin: invocation.stdin,
      timeoutMs: request.timeoutMs,
    });
    if (outcome.timedOut) {
      throw new Error(`agent timed out after ${request.timeoutMs}ms`);
    }
    if (outcome.code !== 0) {
      throw new Error(
        `${adapter.binary} exited ${outcome.code}: ${(outcome.stderr || outcome.stdout).trim().slice(0, 400)}`,
      );
    }
    return adapter.parse(outcome.stdout);
  };

  const execute: ExecuteFn = options.dryRun
    ? async (request) => dryRunResponse(request)
    : async (request) => {
        // A cone needs a run worktree to branch an agent worktree from, and something to fold
        // the patch back into. Without one there's nothing to scope against, so say so rather
        // than silently running the agent with the full checkout in front of it.
        if (request.cone && request.cone.length > 0) {
          if (!worktree) {
            throw new Error(
              `agent "${request.label}" has a cone but the run has no worktree — ` +
                'remove --no-worktree, or drop the cone',
            );
          }
          return runInAgentWorktree(worktree.path, request, adapter.name, (cwd) =>
            callBackend(request, cwd),
          );
        }
        return callBackend(request, request.cwd);
      };

  let workflowRef: { readMeta: () => WorkflowMeta | undefined } | null = null;

  const runtime = createRuntime({
    execute,
    reporter,
    readMeta: () => workflowRef?.readMeta(),
    args: options.args,
    cwd: effectiveCwd,
    concurrency: options.concurrency,
    model: options.model,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    onResult: (result) => {
      if (journalPath) appendFileSync(journalPath, `${JSON.stringify(result)}\n`);
    },
  });

  const workflow = loadWorkflow(resolve(options.scriptPath), runtime.globals);
  workflowRef = workflow;

  // The workflow body may run plain Node fs/child_process code (not just agent() calls) that
  // resolves relative paths against process.cwd() — chdir into the worktree so that code, and
  // any relative per-agent `cwd`, actually stays inside it instead of touching the real checkout.
  const originalCwd = process.cwd();
  if (worktree) process.chdir(effectiveCwd);
  let value: unknown;
  try {
    value = await workflow.execute();
  } finally {
    if (worktree) process.chdir(originalCwd);
  }

  const durationMs = Date.now() - startedAt;
  reporter.banner(workflow.readMeta());
  reporter.summary(runtime.results, durationMs);

  const status: RunStatus =
    runtime.checks.some((check) => !check.ok) || runtime.results.some((result) => !result.ok)
      ? 'red'
      : 'green';
  if (status === 'red') reporter.redReport(runtime.checks, runtime.results);
  if (worktree) reporter.log(`worktree left at ${worktree.path} (branch ${worktree.branch})`);

  return {
    runId,
    meta: workflow.readMeta(),
    value,
    results: runtime.results,
    checks: runtime.checks,
    status,
    durationMs,
    worktree,
  };
}

function dryRunResponse(request: AgentRequest): string {
  if (request.schema) return JSON.stringify(stubForSchema(request.schema));
  return `[dry-run] ${request.label}`;
}
