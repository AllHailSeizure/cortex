import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getAdapter } from './adapters/index.ts';
import { runProcess, resolveBinary } from './exec.ts';
import { createReporter } from './reporter.ts';
import { createRuntime, type ExecuteFn } from './runtime.ts';
import { loadWorkflow } from './script.ts';
import { stubForSchema } from './stub.ts';
import type { AgentRequest, AgentResult, RunOptions, WorkflowMeta } from './types.ts';

export type RunSummary = {
  runId: string;
  meta: WorkflowMeta | undefined;
  value: unknown;
  results: AgentResult[];
  durationMs: number;
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

  const execute: ExecuteFn = options.dryRun
    ? async (request) => dryRunResponse(request)
    : async (request) => {
        const invocation = adapter.build(request, passthroughArgs);
        const outcome = await runProcess(invocation.command, invocation.args, {
          cwd: request.cwd,
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

  let workflowRef: { readMeta: () => WorkflowMeta | undefined } | null = null;

  const runtime = createRuntime({
    execute,
    reporter,
    readMeta: () => workflowRef?.readMeta(),
    args: options.args,
    cwd: options.cwd,
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

  const value = await workflow.execute();
  const durationMs = Date.now() - startedAt;
  reporter.banner(workflow.readMeta());
  reporter.summary(runtime.results, durationMs);

  return { runId, meta: workflow.readMeta(), value, results: runtime.results, durationMs };
}

function dryRunResponse(request: AgentRequest): string {
  if (request.schema) return JSON.stringify(stubForSchema(request.schema));
  return `[dry-run] ${request.label}`;
}
