import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorktree, runWorktreeSetup, workflowSlug } from '../src/worktree.ts';

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-worktree-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'file.txt'), 'hello\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'initial');
  return dir;
}

test('slugs the workflow filename, stripping .workflow.js and friends', () => {
  assert.equal(workflowSlug('/repo/examples/review.workflow.js'), 'review');
  assert.equal(workflowSlug('C:\\repo\\triage.workflow.mjs'), 'triage');
  assert.equal(workflowSlug('plain.js'), 'plain');
  assert.equal(workflowSlug('weird name!!.workflow.js'), 'weird-name');
});

test('creates a worktree on its own branch named after the workflow file', async () => {
  const repo = initRepo();
  try {
    const worktree = await createWorktree(repo, join(repo, 'review.workflow.js'));
    assert.equal(worktree.path, join(repo, '.cortex', 'worktrees', 'review'));
    assert.equal(worktree.root, worktree.path);
    assert.equal(worktree.branch, 'cortex/review');
    assert.ok(existsSync(join(worktree.path, 'file.txt')));

    const branches = execFileSync('git', ['branch', '--list', worktree.branch], {
      cwd: repo,
    }).toString();
    assert.match(branches, /cortex\/review/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('tears down and recreates a stale worktree with the same slug', async () => {
  const repo = initRepo();
  try {
    const scriptPath = join(repo, 'review.workflow.js');
    const first = await createWorktree(repo, scriptPath);
    writeFileSync(join(first.path, 'marker.txt'), 'left over from the first run\n');

    const second = await createWorktree(repo, scriptPath);
    assert.equal(second.path, first.path);
    assert.ok(!existsSync(join(second.path, 'marker.txt')), 'stale worktree should be torn down first');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('offsets root inside the worktree when cwd is a subdirectory of the repo', async () => {
  const repo = initRepo();
  try {
    const sub = join(repo, 'nested');
    mkdirSync(sub);
    const worktree = await createWorktree(sub, join(repo, 'review.workflow.js'));
    assert.equal(worktree.root, join(worktree.path, 'nested'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('rejects a cwd that is not inside a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-not-a-repo-'));
  try {
    await assert.rejects(
      createWorktree(dir, join(dir, 'review.workflow.js')),
      /not inside a git repository/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const NODE = `"${process.execPath}"`;

test('runWorktreeSetup resolves when the command succeeds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-setup-'));
  try {
    await assert.doesNotReject(runWorktreeSetup(`${NODE} -e "process.exit(0)"`, dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runWorktreeSetup throws with stderr when the command fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-setup-'));
  try {
    await assert.rejects(
      runWorktreeSetup(`${NODE} -e "process.stderr.write('boom'); process.exit(1)"`, dir),
      /worktree setup command failed: boom/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
