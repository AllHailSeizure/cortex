import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validate } from '../src/validate.ts';

test('extracts JSON from a fenced block', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```\n'), { a: 1 });
});

test('extracts JSON embedded in prose', () => {
  assert.deepEqual(extractJson('Here you go: {"a": {"b": [1,2]}} — done'), { a: { b: [1, 2] } });
});

test('ignores braces inside strings', () => {
  assert.deepEqual(extractJson('{"a": "} not the end"}'), { a: '} not the end' });
});

test('throws when there is no JSON', () => {
  assert.throws(() => extractJson('no json here'), /no JSON/);
});

test('reports missing required properties', () => {
  const errors = validate({}, { type: 'object', required: ['a'] });
  assert.deepEqual(errors, ['$: missing required property "a"']);
});

test('reports nested type mismatches with a path', () => {
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } } } } },
  };
  const errors = validate({ items: [{ n: 'x' }] }, schema);
  assert.deepEqual(errors, ['$.items[0].n: expected integer, got string']);
});

test('accepts a valid payload', () => {
  const schema = {
    type: 'object',
    required: ['ok', 'tags'],
    properties: { ok: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } },
  };
  assert.deepEqual(validate({ ok: true, tags: ['a'] }, schema), []);
});

test('enforces enum membership', () => {
  assert.equal(validate('c', { enum: ['a', 'b'] }).length, 1);
  assert.deepEqual(validate('a', { enum: ['a', 'b'] }), []);
});
