import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Named permission profiles, shipped as each backend's own native config rather than as a
 * shared abstraction over all three. The backends restrict at different layers — Claude gates
 * individual tool calls, codex draws an OS-level sandbox — so anything that flattened them into
 * one vocabulary would mean something slightly different depending on who read it.
 */
export const PROFILES = ['editor', 'reader'] as const;

type Backend = {
  /** Environment variable that relocates this backend's whole config root. */
  envVar: string;
  /** The user's real config root, which is where auth material is seeded from. */
  home: () => string;
  /** Filename the profile payload takes inside the config root. */
  settingsFile: string;
  /** Files copied out of the user's real root so the agent stays authenticated. */
  authFiles: string[];
};

/**
 * Each backend can be pointed at a different config root by one environment variable. That's a
 * stronger lever than a project-level config file: a project file is *merged under* the user's
 * own settings and can be widened by them, whereas relocating the root replaces that layer
 * outright, so a profile is authoritative.
 *
 * The catch is that these roots hold credentials as well as settings, so a freshly-made one
 * starts logged out. Auth is seeded across explicitly rather than by copying the whole root —
 * the point of a profile is what the agent *doesn't* have, and a bulk copy would drag the
 * user's skills, MCP servers, and subagents in by default.
 */
const BACKENDS: Record<string, Backend> = {
  claude: {
    envVar: 'CLAUDE_CONFIG_DIR',
    home: () => join(homedir(), '.claude'),
    settingsFile: 'settings.json',
    authFiles: ['.credentials.json'],
  },
  codex: {
    envVar: 'CODEX_HOME',
    home: () => join(homedir(), '.codex'),
    settingsFile: 'config.toml',
    authFiles: ['auth.json'],
  },
  cursor: {
    envVar: 'CURSOR_CONFIG_DIR',
    home: () => join(homedir(), '.cursor'),
    settingsFile: 'cli-config.json',
    authFiles: ['agent-cli-state.json'],
  },
};

const PROFILE_ROOT = fileURLToPath(new URL('../profiles/', import.meta.url));

/** A throwaway config root plus the environment that points the backend at it. */
export type ProfileEnvironment = {
  dir: string;
  env: Record<string, string>;
  dispose: () => void;
};

export function backendFor(adapter: string): Backend | undefined {
  return BACKENDS[adapter];
}

/**
 * Build a config root holding the profile's settings and just enough of the user's real root to
 * stay authenticated, and return the environment that points the backend at it.
 */
export function materializeProfile(profile: string, adapter: string): ProfileEnvironment {
  if (!(PROFILES as readonly string[]).includes(profile)) {
    throw new Error(`unknown profile "${profile}" — available profiles are ${PROFILES.join(', ')}`);
  }

  const backend = BACKENDS[adapter];
  if (!backend) {
    throw new Error(
      `no profile config layout for adapter "${adapter}" — known adapters are ${Object.keys(BACKENDS).join(', ')}`,
    );
  }

  const source = join(PROFILE_ROOT, profile, adapter);
  if (!existsSync(source)) {
    throw new Error(`profile "${profile}" has no config for adapter "${adapter}" at ${source}`);
  }

  const dir = mkdtempSync(join(tmpdir(), `cortex-${profile}-`));
  try {
    for (const file of backend.authFiles) {
      const from = join(backend.home(), file);
      if (existsSync(from)) cpSync(from, join(dir, file), { recursive: true });
    }
    // Copied last so a profile always wins over anything seeded above it.
    cpSync(source, dir, { recursive: true });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  return {
    dir,
    env: { [backend.envVar]: dir },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Names of the files a materialized profile root contains — used by the tests and reporting. */
export function profileContents(environment: ProfileEnvironment): string[] {
  return readdirSync(environment.dir).sort();
}
