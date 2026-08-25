import { runShellCommand } from './exec.ts';
import { createSemaphore } from './semaphore.ts';
import { extractJson, validate } from './validate.ts';
import type { Reporter } from './reporter.ts';
import type {
  AgentOptions,
  AgentOutcome,
  AgentRequest,
  AgentResult,
  CheckResult,
  JsonSchema,
  WorkflowMeta,
} from './types.ts';

/** Returning a bare string is shorthand for `{ text }` with nothing changed on disk. */
export type ExecuteFn = (
  request: AgentRequest,
  attempt: number,
) => Promise<string | AgentOutcome>;

export type RuntimeConfig = {
  execute: ExecuteFn;
  reporter: Reporter;
  readMeta: () => WorkflowMeta | undefined;
  args: unknown;
  cwd: string;
  concurrency: number;
  model?: string;
  timeoutMs: number;
  retries: number;
  onResult?: (result: AgentResult) => void;
};

export type Runtime = {
  globals: Record<string, unknown>;
  results: AgentResult[];
  checks: CheckResult[];
};

export function createRuntime(config: RuntimeConfig): Runtime {
  const semaphore = createSemaphore(config.concurrency);
  const results: AgentResult[] = [];
  const checks: CheckResult[] = [];
  let currentPhase = 'main';
  let counter = 0;

  const announce = () => config.reporter.banner(config.readMeta());

  const phase = (title: string) => {
    announce();
    currentPhase = String(title);
    config.reporter.phase(currentPhase);
  };

  const log = (message: string) => {
    announce();
    config.reporter.log(String(message));
  };

  const agent = async (prompt: string, options: AgentOptions = {}): Promise<unknown> => {
    announce();
    counter += 1;
    const request: AgentRequest = {
      id: counter,
      prompt: String(prompt),
      label: options.label ?? deriveLabel(String(prompt)),
      phase: options.phase ?? currentPhase,
      model: options.model ?? config.model,
      schema: options.schema,
      cwd: options.cwd ?? config.cwd,
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      cone: options.cone,
      profile: options.profile,
    };
    const maxAttempts = Math.max(1, (options.retries ?? config.retries) + 1);

    return semaphore.run(async () => {
      config.reporter.phase(request.phase);
      config.reporter.agentStart(request);
      const startedAt = Date.now();
      let lastError = 'unknown error';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const promptForAttempt = buildPrompt(request, lastError, attempt);
          const raw = await config.execute({ ...request, prompt: promptForAttempt }, attempt);
          const outcome: AgentOutcome = typeof raw === 'string' ? { text: raw } : raw;
          const output = request.schema ? coerce(outcome.text, request.schema) : outcome.text;
          const result = finish(request, true, attempt, startedAt, output, undefined, outcome.changedFiles);
          return result.output;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      finish(request, false, maxAttempts, startedAt, null, lastError);
      return null;
    });
  };

  const finish = (
    request: AgentRequest,
    ok: boolean,
    attempts: number,
    startedAt: number,
    output: unknown,
    error?: string,
    changedFiles?: string[],
  ): AgentResult => {
    const result: AgentResult = {
      id: request.id,
      label: request.label,
      phase: request.phase,
      ok,
      attempts,
      durationMs: Date.now() - startedAt,
      output,
      error,
      changedFiles,
    };
    results.push(result);
    config.reporter.agentEnd(result);
    config.onResult?.(result);
    return result;
  };

  const parallel = async (thunks: Array<() => Promise<unknown>>): Promise<unknown[]> => {
    assertArray(thunks, 'parallel');
    return Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch {
          return null;
        }
      }),
    );
  };

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(previous: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<unknown[]> => {
    assertArray(items, 'pipeline');
    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch {
            return null;
          }
        }
        return value;
      }),
    );
  };

  /**
   * Run a check from the orchestrator, in the run worktree, never inside an agent.
   *
   * Agents don't run tests: a model handed a red suite starts trying hypotheses, and that
   * churn is the thing cones can't bound. A failing check is data the workflow can branch on,
   * so this resolves rather than throwing.
   */
  const verify = async (
    command: string,
    options: { timeoutMs?: number } = {},
  ): Promise<CheckResult> => {
    announce();
    const startedAt = Date.now();
    const outcome = await runShellCommand(
      String(command),
      config.cwd,
      options.timeoutMs ?? config.timeoutMs,
    );
    const result: CheckResult = {
      command: String(command),
      ok: outcome.code === 0 && !outcome.timedOut,
      code: outcome.code,
      output: `${outcome.stdout}${outcome.stderr}`.trim(),
      durationMs: Date.now() - startedAt,
    };
    checks.push(result);
    config.reporter.check(result);
    return result;
  };

  return {
    globals: { agent, parallel, pipeline, phase, log, verify, args: config.args },
    results,
    checks,
  };
}

function coerce(raw: string, schema: JsonSchema): unknown {
  const value = extractJson(raw);
  const errors = validate(value, schema);
  if (errors.length > 0) {
    throw new Error(`schema validation failed:\n- ${errors.join('\n- ')}`);
  }
  return value;
}

function buildPrompt(request: AgentRequest, lastError: string, attempt: number): string {
  if (!request.schema) return request.prompt;

  const instruction = [
    request.prompt,
    '',
    '---',
    'Respond with a single JSON value and nothing else. No prose, no code fences.',
    'It must validate against this JSON Schema:',
    JSON.stringify(request.schema, null, 2),
  ].join('\n');

  if (attempt === 1) return instruction;
  return `${instruction}\n\nYour previous response was rejected: ${lastError}\nReturn corrected JSON only.`;
}

function deriveLabel(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine || 'agent';
}

function assertArray(value: unknown, name: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${name}() expects an array, got ${typeof value}`);
  }
}
