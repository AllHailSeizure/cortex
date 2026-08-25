import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROFILES, applyProfile } from '../src/profiles.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cortex-profile-'));
}

test('lists the profiles that ship with the package', () => {
  assert.deepEqual([...PROFILES], ['editor', 'reader']);
});

test('the editor profile lets claude read and write files but not run commands', () => {
  const dir = scratch();
  try {
    applyProfile(dir, 'editor', 'claude');
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(settings.permissions.allow.includes('Edit'));
    assert.ok(settings.permissions.allow.includes('Read'));
    assert.ok(settings.permissions.deny.includes('Bash'), 'agents must not run commands');
    assert.ok(settings.permissions.deny.includes('Task'), 'agents must not spawn subagents');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reader profile denies writing', () => {
  const dir = scratch();
  try {
    applyProfile(dir, 'reader', 'claude');
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(settings.permissions.allow.includes('Read'));
    assert.ok(settings.permissions.deny.includes('Write'));
    assert.ok(settings.permissions.deny.includes('Edit'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes only the config directory the active adapter reads', () => {
  const dir = scratch();
  try {
    applyProfile(dir, 'editor', 'codex');
    assert.ok(existsSync(join(dir, '.codex', 'config.toml')));
    assert.ok(!existsSync(join(dir, '.claude')), 'should not write another backend\'s config');
    assert.match(readFileSync(join(dir, '.codex', 'config.toml'), 'utf8'), /sandbox_mode\s*=\s*"workspace-write"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reader profile puts codex in read-only mode', () => {
  const dir = scratch();
  try {
    applyProfile(dir, 'reader', 'codex');
    assert.match(readFileSync(join(dir, '.codex', 'config.toml'), 'utf8'), /sandbox_mode\s*=\s*"read-only"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes a cursor config for the cursor adapter', () => {
  const dir = scratch();
  try {
    applyProfile(dir, 'editor', 'cursor');
    assert.ok(existsSync(join(dir, '.cursor', 'cli.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('names the available profiles when asked for one that does not exist', () => {
  const dir = scratch();
  try {
    assert.throws(
      () => applyProfile(dir, 'nope', 'claude'),
      /unknown profile "nope".*editor.*reader/s,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an adapter with no known config layout', () => {
  const dir = scratch();
  try {
    assert.throws(() => applyProfile(dir, 'editor', 'aider'), /no profile config layout for adapter "aider"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
