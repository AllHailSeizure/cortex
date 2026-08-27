import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES, backendFor, materializeProfile, profileContents } from '../src/profiles.ts';

test('lists the profiles that ship with the package', () => {
  assert.deepEqual([...PROFILES], ['editor', 'reader']);
});

test('points the backend at a throwaway config root instead of a project file', () => {
  const environment = materializeProfile('editor', 'claude');
  try {
    // Relocating the root replaces the user's own settings layer rather than merging under it,
    // which is what makes a profile authoritative.
    assert.deepEqual(Object.keys(environment.env), ['CLAUDE_CONFIG_DIR']);
    assert.equal(environment.env.CLAUDE_CONFIG_DIR, environment.dir);
    assert.ok(existsSync(join(environment.dir, 'settings.json')));
  } finally {
    environment.dispose();
  }
});

test('uses each backend its own env var and settings filename', () => {
  const cases: Array<[string, string, string]> = [
    ['claude', 'CLAUDE_CONFIG_DIR', 'settings.json'],
    ['codex', 'CODEX_HOME', 'config.toml'],
    ['cursor', 'CURSOR_CONFIG_DIR', 'cli-config.json'],
  ];

  for (const [adapter, envVar, settingsFile] of cases) {
    const environment = materializeProfile('editor', adapter);
    try {
      assert.equal(environment.env[envVar], environment.dir, `${adapter} env var`);
      assert.ok(existsSync(join(environment.dir, settingsFile)), `${adapter} settings file`);
    } finally {
      environment.dispose();
    }
  }
});

test('the editor profile lets claude read and write files but not run commands', () => {
  const environment = materializeProfile('editor', 'claude');
  try {
    const settings = JSON.parse(readFileSync(join(environment.dir, 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.allow.includes('Edit'));
    assert.ok(settings.permissions.deny.includes('Bash'), 'agents must not run commands');
    assert.ok(settings.permissions.deny.includes('Task'), 'agents must not spawn subagents');
  } finally {
    environment.dispose();
  }
});

test('the reader profile denies writing', () => {
  const environment = materializeProfile('reader', 'claude');
  try {
    const settings = JSON.parse(readFileSync(join(environment.dir, 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.deny.includes('Write'));
    assert.ok(settings.permissions.deny.includes('Edit'));
  } finally {
    environment.dispose();
  }
});

test('carries auth across so a relocated root is not a logged-out one', () => {
  const backend = backendFor('claude');
  assert.ok(backend);

  const environment = materializeProfile('editor', 'claude');
  try {
    for (const file of backend.authFiles) {
      // Only assert the copy happened when the real machine actually has that file.
      if (existsSync(join(backend.home(), file))) {
        assert.ok(existsSync(join(environment.dir, file)), `${file} should be seeded`);
      }
    }
  } finally {
    environment.dispose();
  }
});

test('seeds nothing beyond auth and the profile itself', () => {
  const environment = materializeProfile('editor', 'claude');
  try {
    // The point of a profile is what the agent does NOT have — no skills, no MCP servers, no
    // subagents unless an environment explicitly grants them.
    const allowed = new Set(['settings.json', ...(backendFor('claude')?.authFiles ?? [])]);
    for (const entry of profileContents(environment)) {
      assert.ok(allowed.has(entry), `unexpected ${entry} in a materialized profile`);
    }
  } finally {
    environment.dispose();
  }
});

test('cleans up the config root on dispose', () => {
  const environment = materializeProfile('editor', 'claude');
  environment.dispose();
  assert.ok(!existsSync(environment.dir));
});

test('names the available profiles when asked for one that does not exist', () => {
  assert.throws(
    () => materializeProfile('nope', 'claude'),
    /unknown profile "nope".*editor.*reader/s,
  );
});

test('rejects an adapter with no known config layout', () => {
  assert.throws(
    () => materializeProfile('editor', 'aider'),
    /no profile config layout for adapter "aider"/,
  );
});
