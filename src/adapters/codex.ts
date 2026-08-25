import type { Adapter } from './types.ts';

export const codexAdapter: Adapter = {
  name: 'codex',
  binary: 'codex',
  verified: true,
  build(request, extraArgs) {
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', request.cwd];
    if (request.model) args.push('--model', request.model);
    args.push(...extraArgs, '-');
    return { command: 'codex', args, stdin: request.prompt };
  },
  parse(stdout) {
    const messages: string[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const failure = readFailure(event);
      if (failure) throw new Error(failure);
      const text = readAgentMessage(event);
      if (text) messages.push(text);
    }

    if (messages.length === 0) {
      const plain = stdout.trim();
      if (plain && !plain.startsWith('{')) return plain;
      throw new Error('codex produced no agent message');
    }
    return messages[messages.length - 1];
  },
};

function readFailure(event: Record<string, unknown>): string | null {
  const type = String(event.type ?? '');
  if (type === 'error' && typeof event.message === 'string') return event.message;
  if (type === 'turn.failed') {
    const error = event.error as Record<string, unknown> | undefined;
    if (error && typeof error.message === 'string') return error.message;
    return 'codex turn failed';
  }
  return null;
}

function readAgentMessage(event: Record<string, unknown>): string | null {
  const type = String(event.type ?? '');

  if (type === 'item.completed') {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || item.type !== 'agent_message') return null;
    return typeof item.text === 'string' ? item.text : null;
  }

  const legacy = (event.msg ?? event) as Record<string, unknown>;
  if (String(legacy.type ?? '') !== 'agent_message') return null;
  if (typeof legacy.message === 'string') return legacy.message;
  return typeof legacy.text === 'string' ? legacy.text : null;
}
