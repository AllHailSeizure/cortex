import {
  applyPatch,
  captureAgentPatch,
  createAgentWorktree,
  removeAgentWorktree,
} from './worktree.ts';
import type { AgentOutcome, AgentRequest } from './types.ts';

/**
 * Run one agent inside a workspace bounded by its cone, then fold the result back.
 *
 * The cone is the portable bound — sparse checkout behaves identically for every backend, so
 * scope stops being an instruction the model can reason its way past. Permissions are a separate
 * axis handled by the profile's relocated config root, which is why nothing about config touches
 * this worktree at all.
 *
 * The agent worktree is always torn down; its work survives only as a patch applied to the run
 * worktree. If that patch conflicts, this throws — the caller records a failed agent, which
 * turns the run red. Nothing is auto-merged.
 */
export async function runInAgentWorktree(
  runWorktreePath: string,
  request: AgentRequest,
  body: (cwd: string) => Promise<string>,
): Promise<AgentOutcome> {
  const worktree = await createAgentWorktree(runWorktreePath, request.id, request.cone ?? []);

  try {
    const text = await body(worktree.path);
    const { patch, files } = await captureAgentPatch(worktree);
    await applyPatch(runWorktreePath, patch);
    return { text, changedFiles: files };
  } finally {
    await removeAgentWorktree(runWorktreePath, worktree);
  }
}
