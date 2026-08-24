import type { Adapter } from './types.ts';

export const codexAdapter: Adapter = {
  name: 'codex',
  binary: 'codex',
  verified: false,
  build(request, extraArgs) {
    const args = ['exec', '--json', '--skip-git-repo-check'];
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
      const text = readAgentMessage(event);
      if (text) messages.push(text);
    }
    if (messages.length === 0) {
      const plain = stdout.trim();
      if (plain) return plain;
      throw new Error('codex produced no agent message');
    }
    return messages[messages.length - 1];
  },
};

function readAgentMessage(event: Record<string, unknown>): string | null {
  const payload = (event.msg ?? event) as Record<string, unknown>;
  const type = String(payload.type ?? '');
  if (type !== 'agent_message' && type !== 'item.completed' && type !== 'assistant_message') return null;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.text === 'string') return payload.text;
  const item = payload.item as Record<string, unknown> | undefined;
  if (item && typeof item.text === 'string') return item.text;
  return null;
}
