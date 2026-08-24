import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformScript } from '../src/script.ts';

test('captures meta into the run capture object', () => {
  const output = transformScript('export const meta = { name: "x", description: "y" };\n');
  assert.match(output, /var meta = __cortex\.meta = \{ name: "x"/);
});

test('strips other top-level exports', () => {
  const output = transformScript(
    'export const meta = {};\nexport function helper() {}\nexport const N = 1;\n',
  );
  assert.ok(!/^export /m.test(output));
  assert.match(output, /^function helper/m);
});

test('rejects a script without meta', () => {
  assert.throws(() => transformScript('const meta = {};'), /must start with/);
});

test('rejects import statements', () => {
  assert.throws(
    () => transformScript("import fs from 'node:fs';\nexport const meta = {};"),
    /cannot use import/,
  );
});
