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

test('codex runs in the request cwd and reads the prompt from stdin', () => {
  const invocation = getAdapter('codex').build(request, ['-s', 'read-only']);
  assert.deepEqual(invocation.args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-C',
    process.cwd(),
    '--model',
    'opus',
    '-s',
    'read-only',
    '-',
  ]);
});

test('codex parse takes the last agent_message item', () => {
  const stream = [
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"first"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"second"}}',
    '{"type":"turn.completed","usage":{"output_tokens":27}}',
  ].join('\n');
  assert.equal(getAdapter('codex').parse(stream), 'second');
});

test('codex parse ignores non-message items that also carry text', () => {
  const stream = [
    '{"type":"item.completed","item":{"type":"reasoning","text":"thinking out loud"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"the answer"}}',
  ].join('\n');
  assert.equal(getAdapter('codex').parse(stream), 'the answer');
});

test('codex parse surfaces a failed turn', () => {
  const stream = [
    '{"type":"turn.started"}',
    '{"type":"turn.failed","error":{"message":"invalid_json_schema"}}',
  ].join('\n');
  assert.throws(() => getAdapter('codex').parse(stream), /invalid_json_schema/);
});

test('codex parse falls back to plain stdout', () => {
  assert.equal(getAdapter('codex').parse('plain answer\n'), 'plain answer');
});

test('cursor takes the prompt as the trailing argument, not on stdin', () => {
  const invocation = getAdapter('cursor').build(request, ['--trust']);
  assert.equal(invocation.stdin, undefined);
  assert.deepEqual(invocation.args, [
    '-p',
    '--output-format',
    'json',
    '--workspace',
    process.cwd(),
    '--model',
    'opus',
    '--trust',
    'do the thing',
  ]);
});

test('cursor parse reads the result field', () => {
  assert.equal(getAdapter('cursor').parse('{"result":"answer"}'), 'answer');
});

test('cursor parse handles a result that is itself JSON text', () => {
  assert.equal(
    getAdapter('cursor').parse('{"type":"result","is_error":false,"result":"{\\"answer\\":42}"}'),
    '{"answer":42}',
  );
});

test('claude and codex pass the prompt on stdin', () => {
  for (const name of ['claude', 'codex']) {
    assert.equal(getAdapter(name).build(request, []).stdin, 'do the thing', name);
  }
});

test('unknown adapters fail loudly', () => {
  assert.throws(() => getAdapter('gpt'), /unknown adapter/);
});
