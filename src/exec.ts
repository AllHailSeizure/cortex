import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';

const POWERSHELL = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

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
  const plan = planInvocation(resolved, args);

  return new Promise((resolve, reject) => {
    const { command: spawnCommand, args: spawnArgs, verbatim } = plan;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsVerbatimArguments: verbatim,
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

export function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

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
  });
}

export type Invocation = {
  command: string;
  args: string[];
  verbatim: boolean;
};

export function planInvocation(resolved: string, args: string[]): Invocation {
  const isShim =
    process.platform === 'win32' && SHIM_EXTENSIONS.has(extname(resolved).toLowerCase());
  if (!isShim) return { command: resolved, args, verbatim: false };

  if (args.some((arg) => /[\r\n]/.test(arg))) {
    const script = `${resolved.slice(0, -extname(resolved).length)}.ps1`;
    if (!isExecutable(script)) {
      throw new Error(
        `${resolved} is a cmd shim and cmd.exe truncates arguments at the first newline, ` +
          `but no sibling ${script} exists to route around it`,
      );
    }
    return {
      command: POWERSHELL,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      verbatim: false,
    };
  }

  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${[resolved, ...args].map(quoteForCmd).join(' ')}"`],
    verbatim: true,
  };
}

export function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
