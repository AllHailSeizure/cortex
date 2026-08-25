import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.ts';

function withTempDir(run: (dir: string, configPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-config-'));
  const configPath = join(dir, '.cortex', 'config');
  try {
    mkdirSync(join(dir, '.cortex'), { recursive: true });
    run(dir, configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns an empty config when .cortex/config is absent', () => {
  withTempDir((dir) => {
    assert.deepEqual(loadConfig(dir), {});
  });
});

test('parses worktree and worktreeSetup from .cortex/config', () => {
  withTempDir((dir, configPath) => {
    writeFileSync(configPath, JSON.stringify({ worktree: false, worktreeSetup: 'npm install' }));
    assert.deepEqual(loadConfig(dir), { worktree: false, worktreeSetup: 'npm install' });
  });
});

test('throws on invalid JSON', () => {
  withTempDir((dir, configPath) => {
    writeFileSync(configPath, '{ not json');
    assert.throws(() => loadConfig(dir), /not valid JSON/);
  });
});

test('throws when the file is not a JSON object', () => {
  withTempDir((dir, configPath) => {
    writeFileSync(configPath, '[1, 2, 3]');
    assert.throws(() => loadConfig(dir), /must contain a JSON object/);
  });
});
