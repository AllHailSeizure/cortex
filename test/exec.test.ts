import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteForCmd, resolveBinary, runProcess } from '../src/exec.ts';

test('resolves a binary that is on PATH', () => {
  assert.ok(resolveBinary('node'));
});

test('returns null for a binary that is not on PATH', () => {
  assert.equal(resolveBinary('definitely-not-a-real-binary-xyz'), null);
});

test('runs a process and captures stdout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("hi")'], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hi');
  assert.equal(result.timedOut, false);
});

test('pipes stdin into the child process', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'process.stdin.on("data", (d) => process.stdout.write(d))'],
    { cwd: process.cwd(), stdin: 'from stdin', timeoutMs: 10_000 },
  );
  assert.equal(result.stdout, 'from stdin');
});

test('reports a non-zero exit code with stderr', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'process.stderr.write("boom"); process.exit(3)'],
    { cwd: process.cwd(), timeoutMs: 10_000 },
  );
  assert.equal(result.code, 3);
  assert.equal(result.stderr, 'boom');
});

test('kills a process that exceeds its timeout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    cwd: process.cwd(),
    timeoutMs: 200,
  });
  assert.equal(result.timedOut, true);
});

test('quotes cmd arguments by doubling inner quotes', () => {
  assert.equal(quoteForCmd('plain'), '"plain"');
  assert.equal(quoteForCmd('has space'), '"has space"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
});
