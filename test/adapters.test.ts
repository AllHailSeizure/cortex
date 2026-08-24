import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter } from '../src/adapters/index.ts';
import type { AgentRequest } from '../src/types.ts';

const request: AgentRequest = {
  id: 1,
  prompt: 'do the thing',
  label: 'x',
  phase: 'main',
  model: 'opus',
  cwd: process.cwd(),
  timeoutMs: 1000,
};

test('claude sends the prompt on stdin and asks for JSON output', () => {
  const invocation = getAdapter('claude').build(request, ['--permission-mode', 'plan']);
  assert.equal(invocation.command, 'claude');
  assert.deepEqual(invocation.args, [
    '-p',
    '--output-format',
    'json',
    '--model',
    'opus',
    '--permission-mode',
    'plan',
  ]);
  assert.equal(invocation.stdin, 'do the thing');
});

test('claude parse extracts the result field', () => {
  assert.equal(getAdapter('claude').parse('{"result":"done","is_error":false}'), 'done');
});

test('claude parse surfaces backend errors', () => {
  assert.throws(
    () => getAdapter('claude').parse('{"result":"rate limited","is_error":true}'),
    /rate limited/,
  );
});

test('codex parse takes the last agent message from the event stream', () => {
  const stream = [
    '{"msg":{"type":"task_started"}}',
    '{"msg":{"type":"agent_message","message":"first"}}',
    '{"msg":{"type":"agent_message","message":"second"}}',
  ].join('\n');
  assert.equal(getAdapter('codex').parse(stream), 'second');
});

test('codex parse falls back to plain stdout', () => {
  assert.equal(getAdapter('codex').parse('plain answer\n'), 'plain answer');
});

test('cursor parse reads the result field', () => {
  assert.equal(getAdapter('cursor').parse('{"result":"answer"}'), 'answer');
});

test('every adapter passes the prompt on stdin', () => {
  for (const name of ['claude', 'codex', 'cursor']) {
    assert.equal(getAdapter(name).build(request, []).stdin, 'do the thing', name);
  }
});

test('unknown adapters fail loudly', () => {
  assert.throws(() => getAdapter('gpt'), /unknown adapter/);
});
