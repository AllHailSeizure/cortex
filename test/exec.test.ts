import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planInvocation, quoteForCmd, resolveBinary, runProcess } from '../src/exec.ts';

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

test('a real executable is spawned directly, with no shell in between', () => {
  const plan = planInvocation(process.execPath, ['-e', 'null']);
  assert.equal(plan.command, process.execPath);
  assert.deepEqual(plan.args, ['-e', 'null']);
  assert.equal(plan.verbatim, false);
});

const windowsOnly = { skip: process.platform !== 'win32' ? 'windows only' : false };

test('single-line args go through cmd.exe', windowsOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-shim-'));
  try {
    const shim = join(dir, 'thing.cmd');
    writeFileSync(shim, '@echo off\n');
    const plan = planInvocation(shim, ['-p', 'one line']);
    assert.match(plan.command.toLowerCase(), /cmd\.exe$/);
    assert.equal(plan.verbatim, true);
    assert.match(plan.args[3], /"one line"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-line args route around cmd.exe via the sibling ps1', windowsOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-shim-'));
  try {
    const shim = join(dir, 'thing.cmd');
    writeFileSync(shim, '@echo off\n');
    writeFileSync(join(dir, 'thing.ps1'), '');
    const plan = planInvocation(shim, ['-p', 'line one\nline two']);
    assert.match(plan.command.toLowerCase(), /powershell\.exe$/);
    assert.equal(plan.verbatim, false);
    assert.equal(plan.args.at(-1), 'line one\nline two');
    assert.ok(plan.args.includes(join(dir, 'thing.ps1')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a multi-line arg with no ps1 escape hatch fails instead of truncating', windowsOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-shim-'));
  try {
    const shim = join(dir, 'thing.cmd');
    writeFileSync(shim, '@echo off\n');
    assert.throws(() => planInvocation(shim, ['line one\nline two']), /truncates arguments/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
