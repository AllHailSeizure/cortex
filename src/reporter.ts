import type { AgentRequest, AgentResult, WorkflowMeta } from './types.ts';

export type Reporter = {
  banner: (meta: WorkflowMeta | undefined) => void;
  phase: (title: string) => void;
  log: (message: string) => void;
  agentStart: (request: AgentRequest) => void;
  agentEnd: (result: AgentResult) => void;
  summary: (results: AgentResult[], durationMs: number) => void;
};

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
    summary(results, durationMs) {
      const failed = results.filter((result) => !result.ok).length;
      write(
        `\n${results.length} agent(s), ${failed} failed, ${(durationMs / 1000).toFixed(1)}s total\n`,
      );
    },
  };
}
