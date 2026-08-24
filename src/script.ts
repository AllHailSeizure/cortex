import { readFileSync } from 'node:fs';
import type { WorkflowMeta } from './types.ts';

const META_PATTERN = /^[ \t]*export[ \t]+const[ \t]+meta[ \t]*=/m;
const EXPORT_PATTERN = /^[ \t]*export[ \t]+(?=(?:const|let|var|function|async|class)\b)/gm;
const IMPORT_PATTERN = /^[ \t]*import[ \t]+[^\n]*from[ \t]*['"]/m;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function transformScript(source: string): string {
  if (IMPORT_PATTERN.test(source)) {
    throw new Error(
      'workflow scripts cannot use import statements; they run with injected globals only',
    );
  }
  if (!META_PATTERN.test(source)) {
    throw new Error('workflow script must start with `export const meta = { name, description }`');
  }
  return source.replace(META_PATTERN, 'var meta = __cortex.meta =').replace(EXPORT_PATTERN, '');
}

export type LoadedWorkflow = {
  readMeta: () => WorkflowMeta | undefined;
  execute: () => Promise<unknown>;
};

export function compileWorkflow(source: string, globals: Record<string, unknown>): LoadedWorkflow {
  const body = transformScript(source);
  const names = Object.keys(globals);
  const capture: { meta?: WorkflowMeta } = {};

  const fn = new AsyncFunction('__cortex', ...names, body) as (
    capture: unknown,
    ...injected: unknown[]
  ) => Promise<unknown>;

  return {
    readMeta: () => capture.meta,
    execute: () => fn(capture, ...names.map((name) => globals[name])),
  };
}

export function loadWorkflow(scriptPath: string, globals: Record<string, unknown>): LoadedWorkflow {
  return compileWorkflow(readFileSync(scriptPath, 'utf8'), globals);
}
