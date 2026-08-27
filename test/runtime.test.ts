import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.ts';
import { createReporter } from '../src/reporter.ts';
import type { AgentOutcome, AgentRequest, CheckResult } from '../src/types.ts';

type Globals = {
  agent: (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>;
  pipeline: (
    items: unknown[],
    ...stages: Array<(previous: unknown, item: unknown, index: number) => Promise<unknown>>
  ) => Promise<unknown[]>;
  verify: (command: string, options?: { timeoutMs?: number }) => Promise<CheckResult>;
};

function harness(
  execute: (request: AgentRequest, attempt: number) => Promise<string | AgentOutcome>,
  concurrency = 4,
) {
  const runtime = createRuntime({
    execute,
    reporter: createReporter(true),
    readMeta: () => undefined,
    args: undefined,
    cwd: process.cwd(),
    concurrency,
    timeoutMs: 10_000,
    retries: 1,
  });
  return {
    ...(runtime.globals as unknown as Globals),
    results: runtime.results,
    checks: runtime.checks,
  };
}

const NODE = `"${process.execPath}"`;

test('returns raw text when no schema is given', async () => {
  const { agent } = harness(async () => 'hello');
  assert.equal(await agent('say hi'), 'hello');
});

test('parses and validates schema output', async () => {
  const { agent } = harness(async () => '```json\n{"n": 3}\n```');
  const schema = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } };
  assert.deepEqual(await agent('count', { schema }), { n: 3 });
});

test('retries invalid output and feeds the schema error back', async () => {
  const prompts: string[] = [];
  const { agent, results } = harness(async (request, attempt) => {
    prompts.push(request.prompt);
    return attempt === 1 ? '{"n": "nope"}' : '{"n": 7}';
  });

  const schema = { type: 'object', properties: { n: { type: 'integer' } } };
  assert.deepEqual(await agent('count', { schema }), { n: 7 });
  assert.equal(results[0].attempts, 2);
  assert.match(prompts[1], /previous response was rejected/);
  assert.match(prompts[1], /expected integer, got string/);
});

test('returns null and records failure when every attempt fails', async () => {
  const { agent, results } = harness(async () => {
    throw new Error('backend exploded');
  });
  assert.equal(await agent('doomed'), null);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error ?? '', /backend exploded/);
});

test('parallel resolves a throwing thunk to null without rejecting', async () => {
  const { parallel } = harness(async () => 'ok');
  const values = await parallel([
    async () => 1,
    async () => {
      throw new Error('nope');
    },
    async () => 3,
  ]);
  assert.deepEqual(values, [1, null, 3]);
});

test('pipeline threads stages per item and passes the original item along', async () => {
  const { pipeline } = harness(async () => 'ok');
  const values = await pipeline(
    ['a', 'b'],
    async (previous) => `${previous}1`,
    async (previous, item, index) => `${previous}-${item}-${index}`,
  );
  assert.deepEqual(values, ['a1-a-0', 'b1-b-1']);
});

test('pipeline drops a failing item to null and leaves the rest alone', async () => {
  const { pipeline } = harness(async () => 'ok');
  const values = await pipeline(
    [1, 2, 3],
    async (previous) => {
      if (previous === 2) throw new Error('bad');
      return previous;
    },
    async (previous) => (previous as number) * 10,
  );
  assert.deepEqual(values, [10, null, 30]);
});

test('items advance through the pipeline without a barrier between stages', async () => {
  const order: string[] = [];
  const { pipeline } = harness(async () => 'ok');
  await pipeline(
    ['fast', 'slow'],
    async (item) => {
      await new Promise((done) => setTimeout(done, item === 'slow' ? 40 : 1));
      order.push(`stage1:${item}`);
      return item;
    },
    async (item) => {
      order.push(`stage2:${item}`);
      return item;
    },
  );
  assert.deepEqual(order, ['stage1:fast', 'stage2:fast', 'stage1:slow', 'stage2:slow']);
});

test('carries the cone and profile through to the request', async () => {
  let seen: AgentRequest | undefined;
  const { agent } = harness(async (request) => {
    seen = request;
    return 'ok';
  });

  await agent('edit it', { cone: ['src/a.ts'], profile: 'editor' });
  assert.deepEqual(seen?.cone, ['src/a.ts']);
  assert.equal(seen?.profile, 'editor');
});

test('leaves the cone unset when the call does not ask for one', async () => {
  let seen: AgentRequest | undefined;
  const { agent } = harness(async (request) => {
    seen = request;
    return 'ok';
  });

  await agent('anything');
  assert.equal(seen?.cone, undefined);
  assert.equal(seen?.cwd, process.cwd());
});

test('records which files an agent changed', async () => {
  const { agent, results } = harness(async () => ({
    text: 'done',
    changedFiles: ['src/a.ts', 'src/b.ts'],
  }));

  assert.equal(await agent('edit it'), 'done');
  assert.deepEqual(results[0].changedFiles, ['src/a.ts', 'src/b.ts']);
});

test('verify runs a check in the orchestrator and records it', async () => {
  const { verify, checks } = harness(async () => 'ok');

  const result = await verify(`${NODE} -e "process.exit(0)"`);
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(checks.length, 1);
});

test('a red check resolves with the failure instead of throwing', async () => {
  const { verify, checks } = harness(async () => 'ok');

  const result = await verify(`${NODE} -e "process.stderr.write('boom'); process.exit(1)"`);
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assert.match(result.output, /boom/);
  assert.equal(checks[0].ok, false);
});

test('the concurrency limit applies across agent calls', async () => {
  let active = 0;
  let peak = 0;
  const { parallel, agent } = harness(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 5));
    active -= 1;
    return 'ok';
  }, 2);

  await parallel(Array.from({ length: 6 }, (_, index) => () => agent(`task ${index}`)));
  assert.equal(peak, 2);
});
