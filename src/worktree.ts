import { mkdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { runProcess, runShellCommand } from './exec.ts';

export type Worktree = {
  /** Absolute path agents should treat as their working directory — mirrors cwd's offset from the repo root. */
  root: string;
  /** Absolute path to the worktree's own checkout root. */
  path: string;
  branch: string;
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
