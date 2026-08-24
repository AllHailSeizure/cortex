import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv } from '../src/argv.ts';

test('keeps the script path as a positional when flags precede it', () => {
  const parsed = parseArgv(['--adapter', 'codex', 'flow.js']);
  assert.deepEqual(parsed.positionals, ['flow.js']);
  assert.equal(parsed.flags.get('adapter'), 'codex');
});

test('supports --flag=value', () => {
  const parsed = parseArgv(['flow.js', '--concurrency=3']);
  assert.equal(parsed.flags.get('concurrency'), '3');
});

test('treats unknown flags as booleans without eating the next token', () => {
  const parsed = parseArgv(['--dry-run', 'flow.js']);
  assert.ok(parsed.flags.has('dry-run'));
  assert.equal(parsed.flags.get('dry-run'), undefined);
  assert.deepEqual(parsed.positionals, ['flow.js']);
});

test('splits passthrough args at the double dash', () => {
  const parsed = parseArgv(['flow.js', '--', '--permission-mode', 'plan']);
  assert.deepEqual(parsed.passthrough, ['--permission-mode', 'plan']);
  assert.deepEqual(parsed.positionals, ['flow.js']);
});
