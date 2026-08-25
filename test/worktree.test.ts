import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyPatch,
  captureAgentPatch,
  createAgentWorktree,
  createWorktree,
  removeAgentWorktree,
  runWorktreeSetup,
  workflowSlug,
} from '../src/worktree.ts';

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-worktree-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'file.txt'), 'hello\n');
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2;\n');
  writeFileSync(join(dir, 'test', 'a.test.ts'), 'assert(a === 1);\n');
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

test('an agent worktree only puts the cone on disk', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 1, ['src/a.ts']);
    assert.ok(existsSync(join(agent.path, 'src', 'a.ts')), 'cone file should be checked out');
    assert.ok(!existsSync(join(agent.path, 'src', 'b.ts')), 'src/b.ts is outside the cone');
    assert.ok(!existsSync(join(agent.path, 'test', 'a.test.ts')), 'tests are outside the cone');
    assert.ok(!existsSync(join(agent.path, 'file.txt')), 'file.txt is outside the cone');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('captures only cone changes as a patch, without staging excluded files as deletions', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 1, ['src/a.ts']);
    writeFileSync(join(agent.path, 'src', 'a.ts'), 'export const a = 99;\n');

    const { patch, files } = await captureAgentPatch(agent);
    assert.deepEqual(files, ['src/a.ts']);
    assert.match(patch, /\+export const a = 99;/);
    assert.doesNotMatch(patch, /src\/b\.ts/, 'excluded files must not appear in the patch');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('captures a brand new file created inside a directory cone', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 2, ['src/']);
    writeFileSync(join(agent.path, 'src', 'c.ts'), 'export const c = 3;\n');

    const { patch, files } = await captureAgentPatch(agent);
    assert.deepEqual(files, ['src/c.ts']);
    assert.match(patch, /new file mode/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('captures nothing when the agent changed nothing', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 3, ['src/a.ts']);
    const { patch, files } = await captureAgentPatch(agent);
    assert.deepEqual(files, []);
    assert.equal(patch, '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('applies a captured patch into the run worktree and leaves the rest alone', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 1, ['src/a.ts']);
    writeFileSync(join(agent.path, 'src', 'a.ts'), 'export const a = 99;\n');
    const { patch } = await captureAgentPatch(agent);

    await applyPatch(repo, patch);
    assert.match(readFileSync(join(repo, 'src', 'a.ts'), 'utf8'), /a = 99/);
    assert.match(readFileSync(join(repo, 'src', 'b.ts'), 'utf8'), /b = 2/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('applyPatch reports a conflict rather than half-applying it', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 1, ['src/a.ts']);
    writeFileSync(join(agent.path, 'src', 'a.ts'), 'export const a = 99;\n');
    const { patch } = await captureAgentPatch(agent);

    // Move the run worktree out from under the patch's expected pre-image.
    writeFileSync(join(repo, 'src', 'a.ts'), 'something else entirely\n');
    await assert.rejects(applyPatch(repo, patch), /git apply failed/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('removing an agent worktree deletes the directory and its git registration', async () => {
  const repo = initRepo();
  try {
    const agent = await createAgentWorktree(repo, 1, ['src/a.ts']);
    assert.ok(existsSync(agent.path));

    await removeAgentWorktree(repo, agent);
    assert.ok(!existsSync(agent.path), 'directory should be gone');

    const list = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString();
    assert.doesNotMatch(list, /agents[/\\]1/, 'git should no longer track the agent worktree');
  } finally {
    rmSync(repo, { recursive: true, force: true });
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
