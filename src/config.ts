import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type CortexConfig = {
  worktree?: boolean;
  worktreeSetup?: string;
};

const CONFIG_FILE = '.cortex/config';

export function loadConfig(cwd: string): CortexConfig {
  const path = join(cwd, '.cortex', 'config');
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_FILE} must contain a JSON object`);
  }
  return parsed as CortexConfig;
}
