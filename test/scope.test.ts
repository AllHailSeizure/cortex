import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInAgentWorktree } from '../src/scope.ts';
import type { AgentRequest } from '../src/types.ts';

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-scope-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2;\n');
  writeFileSync(join(dir, 'secrets.txt'), 'do not read me\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'initial');
  return dir;
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    id: 1,
    prompt: 'edit it',
    label: 'edit',
    phase: 'main',
    cwd: process.cwd(),
    timeoutMs: 1000,
    cone: ['src/a.ts'],
    ...overrides,
  };
}

test('the agent only ever sees its cone', async () => {
  const repo = initRepo();
  try {
    let seen: string[] = [];
    await runInAgentWorktree(repo, request(), async (cwd) => {
      seen = [
        existsSync(join(cwd, 'src', 'a.ts')) ? 'src/a.ts' : '',
        existsSync(join(cwd, 'src', 'b.ts')) ? 'src/b.ts' : '',
        existsSync(join(cwd, 'secrets.txt')) ? 'secrets.txt' : '',
      ].filter(Boolean);
      return 'done';
    });
    assert.deepEqual(seen, ['src/a.ts']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('folds the agent edit back into the run worktree and reports the files', async () => {
  const repo = initRepo();
  try {
    const outcome = await runInAgentWorktree(repo, request(), async (cwd) => {
      writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 42;\n');
      return 'edited';
    });

    assert.equal(outcome.text, 'edited');
    assert.deepEqual(outcome.changedFiles, ['src/a.ts']);
    assert.match(readFileSync(join(repo, 'src', 'a.ts'), 'utf8'), /a = 42/);
    assert.match(readFileSync(join(repo, 'src', 'b.ts'), 'utf8'), /b = 2/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('puts no config of its own inside the worktree', async () => {
  const repo = initRepo();
  try {
    // Permissions travel by relocated config root, not by files dropped in the workspace, so
    // there is nothing here for a wide cone to sweep into the user's repo.
    let strays: string[] = [];
    const outcome = await runInAgentWorktree(
      repo,
      request({ profile: 'editor', cone: ['src/'] }),
      async (cwd) => {
        strays = ['.claude', '.codex', '.cursor'].filter((dir) => existsSync(join(cwd, dir)));
        return 'done';
      },
    );

    assert.deepEqual(strays, []);
    assert.deepEqual(outcome.changedFiles, []);
    assert.ok(!existsSync(join(repo, '.claude')));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('tears the agent worktree down even when the agent throws', async () => {
  const repo = initRepo();
  try {
    await assert.rejects(
      runInAgentWorktree(repo, request(), async () => {
        throw new Error('backend exploded');
      }),
      /backend exploded/,
    );
    assert.ok(!existsSync(join(repo, '.cortex', 'worktrees', 'agents', '1')));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a conflicting patch surfaces as an error rather than a merge', async () => {
  const repo = initRepo();
  try {
    await assert.rejects(
      runInAgentWorktree(repo, request(), async (cwd) => {
        writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 42;\n');
        // Something else moves the run worktree out from under the patch mid-flight.
        writeFileSync(join(repo, 'src', 'a.ts'), 'totally different\n');
        return 'edited';
      }),
      /git apply failed/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
