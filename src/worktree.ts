import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { runProcess, runShellCommand } from './exec.ts';

export type Worktree = {
  /** Absolute path agents should treat as their working directory — mirrors cwd's offset from the repo root. */
  root: string;
  /** Absolute path to the worktree's own checkout root. */
  path: string;
  branch: string;
};

/**
 * A throwaway worktree holding only the files one agent() call is allowed to see. Everything
 * outside `cone` is absent from disk, so scope is a fact about the filesystem rather than an
 * instruction the model can talk itself out of.
 */
export type AgentWorktree = {
  path: string;
  /** Repo-root-relative, gitignore-syntax patterns — the same list is used to capture changes back. */
  cone: string[];
};

/** Basename of the workflow file, extension stripped, sanitized for use as a path segment / branch name. */
export function workflowSlug(scriptPath: string): string {
  const stripped = basename(scriptPath).replace(/\.workflow\.(js|mjs|ts)$/, '').replace(/\.(js|mjs|ts)$/, '');
  const slug = stripped.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'workflow';
}

export async function createWorktree(cwd: string, scriptPath: string): Promise<Worktree> {
  const toplevel = await gitToplevel(cwd);
  const slug = workflowSlug(scriptPath);
  const branch = `cortex/${slug}`;
  const path = resolve(toplevel, '.cortex', 'worktrees', slug);
  mkdirSync(resolve(toplevel, '.cortex', 'worktrees'), { recursive: true });

  let result = await addWorktree(toplevel, path, branch);
  if (result.code !== 0) {
    // The slug is stable across runs of the same workflow, not unique per run — a leftover
    // worktree/branch from a prior run is the expected reason this collides. Tear the old one
    // down and try once more before treating it as a real failure.
    await removeWorktree(toplevel, path, branch);
    result = await addWorktree(toplevel, path, branch);
  }
  if (result.code !== 0) {
    throw new Error(`git worktree add failed: ${(result.stderr || result.stdout).trim()}`);
  }

  const offset = relative(toplevel, resolve(cwd));
  return { root: offset ? join(path, offset) : path, path, branch };
}

export async function createAgentWorktree(
  runWorktreePath: string,
  id: number,
  cone: string[],
): Promise<AgentWorktree> {
  if (cone.length === 0) {
    throw new Error('an agent cone needs at least one path pattern');
  }

  const path = resolve(runWorktreePath, '.cortex', 'worktrees', 'agents', String(id));
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { recursive: true, force: true });

  await git(runWorktreePath, ['worktree', 'add', '--no-checkout', '--detach', path, 'HEAD']);
  // --no-cone takes gitignore-style patterns, so a cone can name individual files and not just
  // directories. Cone mode would silently widen "src/a.ts" to the whole of src/.
  await git(path, ['sparse-checkout', 'set', '--no-cone', ...cone]);
  await git(path, ['checkout']);

  return { path, cone };
}

/**
 * Stage and diff the agent's work, limited by pathspec to the cone. The pathspec is what keeps
 * `add -A` from recording every sparse-excluded file as a deletion.
 */
export async function captureAgentPatch(
  worktree: AgentWorktree,
): Promise<{ patch: string; files: string[] }> {
  await git(worktree.path, ['add', '-A', '--', ...worktree.cone]);

  const names = await git(worktree.path, [
    'diff', '--cached', '--name-only', 'HEAD', '--', ...worktree.cone,
  ]);
  const files = names.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (files.length === 0) return { patch: '', files: [] };

  const diff = await git(worktree.path, ['diff', '--cached', 'HEAD', '--', ...worktree.cone]);
  return { patch: diff.stdout, files };
}

export async function applyPatch(targetPath: string, patch: string): Promise<void> {
  if (patch.trim() === '') return;

  const file = join(tmpdir(), `cortex-${process.pid}-${(patchCounter += 1)}.patch`);
  writeFileSync(file, patch);
  try {
    const result = await runProcess('git', ['apply', '--whitespace=nowarn', file], {
      cwd: targetPath,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      throw new Error(`git apply failed: ${(result.stderr || result.stdout).trim()}`);
    }
  } finally {
    rmSync(file, { force: true });
  }
}

export async function removeAgentWorktree(
  runWorktreePath: string,
  worktree: AgentWorktree,
): Promise<void> {
  await runProcess('git', ['worktree', 'remove', '--force', worktree.path], {
    cwd: runWorktreePath,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  rmSync(worktree.path, { recursive: true, force: true });
}

let patchCounter = 0;

async function git(cwd: string, args: string[]) {
  const result = await runProcess('git', args, { cwd, timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

export async function runWorktreeSetup(command: string, cwd: string): Promise<void> {
  const result = await runShellCommand(command, cwd, 300_000);
  if (result.code !== 0) {
    throw new Error(`worktree setup command failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function addWorktree(toplevel: string, path: string, branch: string) {
  return runProcess('git', ['worktree', 'add', path, '-b', branch], {
    cwd: toplevel,
    timeoutMs: 60_000,
  });
}

async function removeWorktree(toplevel: string, path: string, branch: string): Promise<void> {
  await runProcess('git', ['worktree', 'remove', '--force', path], {
    cwd: toplevel,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  await runProcess('git', ['branch', '-D', branch], { cwd: toplevel, timeoutMs: 10_000 }).catch(
    () => undefined,
  );
}

async function gitToplevel(cwd: string): Promise<string> {
  const result = await runProcess('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    throw new Error(`"${cwd}" is not inside a git repository, so it can't be run in a worktree`);
  }
  return result.stdout.trim();
}
