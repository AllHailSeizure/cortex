import { claudeAdapter } from './claude.ts';
import { codexAdapter } from './codex.ts';
import { cursorAdapter } from './cursor.ts';
import type { Adapter } from './types.ts';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
};

export function getAdapter(name: string): Adapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`unknown adapter "${name}" (known: ${Object.keys(adapters).join(', ')})`);
  }
  return adapter;
}

export type { Adapter };
