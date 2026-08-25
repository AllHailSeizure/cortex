import type { AgentRequest, AgentResult, CheckResult, WorkflowMeta } from './types.ts';

export type Reporter = {
  banner: (meta: WorkflowMeta | undefined) => void;
  phase: (title: string) => void;
  log: (message: string) => void;
  agentStart: (request: AgentRequest) => void;
  agentEnd: (result: AgentResult) => void;
  check: (result: CheckResult) => void;
  summary: (results: AgentResult[], durationMs: number) => void;
  redReport: (checks: CheckResult[], results: AgentResult[]) => void;
};

/** Keep a multi-line command on one line so it can't be mistaken for the report's own structure. */
function oneLine(command: string): string {
  const collapsed = command.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

export function createReporter(quiet: boolean): Reporter {
  let bannerShown = false;
  let currentPhase = '';

  const write = (line: string) => {
    if (!quiet) process.stderr.write(`${line}\n`);
  };

  return {
    banner(meta) {
      if (bannerShown || !meta) return;
      bannerShown = true;
      write(`\ncortex · ${meta.name}`);
      write(`  ${meta.description}`);
      for (const phase of meta.phases ?? []) {
        write(`  · ${phase.title}${phase.detail ? ` — ${phase.detail}` : ''}`);
      }
      write('');
    },
    phase(title) {
      if (title === currentPhase) return;
      currentPhase = title;
      write(`\n▸ ${title}`);
    },
    log(message) {
      write(`  ${message}`);
    },
    agentStart(request) {
      write(`  → [${request.id}] ${request.label}`);
    },
    agentEnd(result) {
      const seconds = (result.durationMs / 1000).toFixed(1);
      const status = result.ok ? '✓' : '✗';
      const detail = result.ok ? '' : ` — ${result.error}`;
      write(`  ${status} [${result.id}] ${result.label} (${seconds}s)${detail}`);
    },
    check(result) {
      const seconds = (result.durationMs / 1000).toFixed(1);
      write(`  ${result.ok ? '✓' : '✗'} check: ${oneLine(result.command)} (${seconds}s)`);
    },
    summary(results, durationMs) {
      const failed = results.filter((result) => !result.ok).length;
      write(
        `\n${results.length} agent(s), ${failed} failed, ${(durationMs / 1000).toFixed(1)}s total\n`,
      );
    },
    // Nothing repairs a red run, so this report is the handoff — it has to carry enough for a
    // human to start debugging without reconstructing who touched what.
    redReport(checks, results) {
      write('RED — this run did not come out clean.\n');

      for (const check of checks.filter((entry) => !entry.ok)) {
        write(`failing check: ${oneLine(check.command)} (exit ${check.code})`);
        for (const line of check.output.split('\n')) write(`  │ ${line}`);
        write('');
      }

      for (const result of results.filter((entry) => !entry.ok)) {
        write(`failed agent: [${result.id}] ${result.label} — ${result.error}`);
      }

      const touched = results.filter((result) => (result.changedFiles?.length ?? 0) > 0);
      if (touched.length > 0) {
        write('\nwho changed what:');
        for (const result of touched) {
          write(`  [${result.id}] ${result.label}`);
          for (const file of result.changedFiles ?? []) write(`      ${file}`);
        }
      }
      write('');
    },
  };
}
