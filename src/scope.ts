import { applyProfile, configDirFor } from './profiles.ts';
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
 * scope stops being an instruction the model can reason its way past. The profile is the
 * per-provider layer on top, written in each backend's own config vocabulary.
 *
 * The agent worktree is always torn down; its work survives only as a patch applied to the run
 * worktree. If that patch conflicts, this throws — the caller records a failed agent, which
 * turns the run red. Nothing is auto-merged.
 */
export async function runInAgentWorktree(
  runWorktreePath: string,
  request: AgentRequest,
  adapter: string,
  body: (cwd: string) => Promise<string>,
): Promise<AgentOutcome> {
  const worktree = await createAgentWorktree(runWorktreePath, request.id, request.cone ?? []);

  try {
    if (request.profile) applyProfile(worktree.path, request.profile, adapter);

    const text = await body(worktree.path);

    // Exclude the profile config from the capture, so a wide cone can't sweep Cortex's own
    // permission files into the patch and commit them to the user's repo.
    const configDir = configDirFor(adapter);
    const exclude = request.profile && configDir ? [configDir] : [];

    const { patch, files } = await captureAgentPatch(worktree, exclude);
    await applyPatch(runWorktreePath, patch);
    return { text, changedFiles: files };
  } finally {
    await removeAgentWorktree(runWorktreePath, worktree);
  }
}
