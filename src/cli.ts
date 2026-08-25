#!/usr/bin/env node
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adapters } from './adapters/index.ts';
import { parseArgv } from './argv.ts';
import { runWorkflow } from './run.ts';
import type { RunOptions } from './types.ts';

const HELP = `cortex — model-agnostic workflow orchestration

Usage:
  cortex run <script.js> [options] [-- <args passed to the agent CLI>]
  cortex adapters
  cortex --help

Options:
  -a, --adapter <name>    Backend: claude | codex | cursor        (default: claude)
  -m, --model <model>     Model passed through to the backend
  -c, --concurrency <n>   Max agents in flight                    (default: cpus-2, max 8)
      --args <json|@file> Value exposed to the script as \`args\`
      --cwd <dir>         Working directory for agents            (default: .)
      --timeout <seconds> Per-agent timeout                       (default: 600)
      --retries <n>       Extra attempts per agent                (default: 1)
      --journal <dir>     Write per-agent JSONL                   (default: .cortex/runs)
      --no-journal        Disable the journal
      --no-worktree       Run against the checkout directly instead of an isolated git worktree
      --dry-run           Stub every agent; exercise control flow only
  -q, --quiet             Suppress progress output
      --json              Print the workflow return value as JSON

Every run defaults to an isolated git worktree at .cortex/worktrees/<workflow-name> on its own
branch (cortex/<workflow-name>) — the workflow script's own file/process side effects, not just
agent() calls, run there instead of in your checkout. It's one slot per workflow file, not per
run: running the same script again tears down and recreates it, so it's left in place when a
run ends but nothing merges back automatically. A .cortex/config file (JSON) can set
{"worktree": false} to change the default, or {"worktreeSetup": "<command>"} to run once inside
a fresh worktree before the workflow starts (e.g. "npm install").
`;

function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return Promise.resolve(0);
  }
  if (command === 'adapters') {
    for (const adapter of Object.values(adapters)) {
      const status = adapter.verified ? 'verified' : 'unverified';
      process.stdout.write(`${adapter.name.padEnd(8)} ${adapter.binary.padEnd(14)} ${status}\n`);
    }
    return Promise.resolve(0);
  }
  if (command !== 'run') {
    process.stderr.write(`unknown command "${command}"\n\n${HELP}`);
    return Promise.resolve(2);
  }
  return runCommand(argv.slice(1));
}

async function runCommand(argv: string[]): Promise<number> {
  const { positionals, flags, passthrough } = parseArgv(argv);
  const scriptPath = positionals[0];
  if (!scriptPath) {
    process.stderr.write('cortex run needs a workflow script path\n');
    return 2;
  }

  const journal = flags.has('no-journal') ? undefined : String(flags.get('journal') ?? '.cortex/runs');

  const options: RunOptions = {
    scriptPath: resolve(scriptPath),
    adapter: String(flags.get('adapter') ?? flags.get('a') ?? 'claude'),
    args: parseArgsValue(flags.get('args')),
    cwd: resolve(String(flags.get('cwd') ?? process.cwd())),
    concurrency: Number(flags.get('concurrency') ?? flags.get('c') ?? defaultConcurrency()),
    model: flags.get('model') ?? flags.get('m'),
    timeoutMs: Number(flags.get('timeout') ?? 600) * 1000,
    retries: Number(flags.get('retries') ?? 1),
    dryRun: flags.has('dry-run'),
    journalDir: journal,
    quiet: flags.has('quiet') || flags.has('q'),
    worktree: flags.has('no-worktree') ? false : undefined,
  };

  const summary = await runWorkflow(options, passthrough);

  if (summary.worktree) {
    process.stderr.write(`worktree: ${summary.worktree.path} (branch ${summary.worktree.branch})\n`);
  }

  if (flags.has('json') || options.quiet) {
    process.stdout.write(`${JSON.stringify(summary.value ?? null, null, 2)}\n`);
  } else if (summary.value !== undefined) {
    process.stdout.write(`${format(summary.value)}\n`);
  }

  return summary.results.some((result) => !result.ok) ? 1 : 0;
}

function parseArgsValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const text = raw.startsWith('@') ? readFileSync(resolve(raw.slice(1)), 'utf8') : raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function defaultConcurrency(): number {
  return Math.max(1, Math.min(8, availableParallelism() - 2));
}

function format(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`cortex: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
