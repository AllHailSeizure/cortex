import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../src/run.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/simple.workflow.js', import.meta.url));

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    scriptPath: FIXTURE,
    adapter: 'claude',
    args: { targets: ['a', 'b'] },
    cwd: process.cwd(),
    concurrency: 2,
    timeoutMs: 1000,
    retries: 0,
    dryRun: true,
    journalDir: undefined,
    quiet: true,
    ...overrides,
  };
}

test('a dry run executes the whole script and returns its value', async () => {
  const summary = await runWorkflow(baseOptions());

  assert.equal(summary.meta?.name, 'fixture');
  assert.equal(summary.results.length, 3);
  assert.ok(summary.results.every((result) => result.ok));
  assert.deepEqual(summary.value, {
    scored: [
      { target: 'a', score: 0 },
      { target: 'b', score: 0 },
    ],
    summary: '[dry-run] summarize the scores',
  });
});

test('phases are recorded per agent', async () => {
  const summary = await runWorkflow(baseOptions());
  assert.deepEqual(
    summary.results.map((result) => result.phase).sort(),
    ['Collect', 'Collect', 'Summarize'],
  );
});

test('the journal records one line per agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-journal-'));
  try {
    const summary = await runWorkflow(baseOptions({ journalDir: dir }));
    const runDir = join(dir, readdirSync(dir)[0]);
    const lines = readFileSync(join(runDir, 'journal.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, summary.results.length);
    assert.equal(JSON.parse(lines[0]).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing backend binary fails before any agent runs', async () => {
  await assert.rejects(
    runWorkflow(baseOptions({ dryRun: false, adapter: 'cursor' })),
    /needs "cursor-agent" on PATH/,
  );
});
