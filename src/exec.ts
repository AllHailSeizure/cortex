import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const SHIM_EXTENSIONS = new Set(['.cmd', '.bat']);

export function resolveBinary(command: string): string | null {
  if (isAbsolute(command) && isExecutable(command)) return command;

  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = join(dir, command + ext.toLowerCase());
      if (isExecutable(candidate)) return candidate;
    }
    if (isExecutable(join(dir, command))) return join(dir, command);
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; stdin?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  const resolved = resolveBinary(command) ?? command;
  const useShim = process.platform === 'win32' && SHIM_EXTENSIONS.has(extname(resolved).toLowerCase());

  const spawnCommand = useShim ? (process.env.ComSpec ?? 'cmd.exe') : resolved;
  const spawnArgs = useShim
    ? ['/d', '/s', '/c', `"${[resolved, ...args].map(quoteForCmd).join(' ')}"`]
    : args;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsVerbatimArguments: useShim,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

export function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
