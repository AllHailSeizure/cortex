import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Named permission profiles, shipped as each backend's own native config rather than as a
 * shared abstraction over all three. The backends restrict at different layers — Claude gates
 * individual tool calls, codex draws an OS-level sandbox — so anything that flattened them into
 * one vocabulary would mean something slightly different depending on who read it.
 */
export const PROFILES = ['editor', 'reader'] as const;

/**
 * Where each backend looks for project-level config, relative to its working directory. The
 * payloads are stored under an undotted directory name (`profiles/editor/claude/`) and only get
 * the leading dot on the way out — a checked-in `.claude/settings.local.json` collides with the
 * near-universal gitignore rule for personal Claude settings and would silently fail to ship.
 */
const CONFIG_DIRS: Record<string, string> = {
  claude: '.claude',
  codex: '.codex',
  cursor: '.cursor',
};

const PROFILE_ROOT = fileURLToPath(new URL('../profiles/', import.meta.url));

/** The dotted config directory the given backend reads, or undefined if we don't know its layout. */
export function configDirFor(adapter: string): string | undefined {
  return CONFIG_DIRS[adapter];
}

export function applyProfile(worktreePath: string, profile: string, adapter: string): void {
  if (!(PROFILES as readonly string[]).includes(profile)) {
    throw new Error(`unknown profile "${profile}" — available profiles are ${PROFILES.join(', ')}`);
  }

  const configDir = CONFIG_DIRS[adapter];
  if (!configDir) {
    throw new Error(
      `no profile config layout for adapter "${adapter}" — known adapters are ${Object.keys(CONFIG_DIRS).join(', ')}`,
    );
  }

  const source = join(PROFILE_ROOT, profile, adapter);
  if (!existsSync(source)) {
    throw new Error(`profile "${profile}" has no config for adapter "${adapter}" at ${source}`);
  }

  cpSync(source, join(worktreePath, configDir), { recursive: true });
}
