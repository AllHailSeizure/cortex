import type { Adapter } from './types.ts';

export const claudeAdapter: Adapter = {
  name: 'claude',
  binary: 'claude',
  verified: true,
  build(request, extraArgs) {
    const args = ['-p', '--output-format', 'json'];
    if (request.model) args.push('--model', request.model);
    args.push(...extraArgs);
    return { command: 'claude', args, stdin: request.prompt };
  },
  parse(stdout) {
    const payload = JSON.parse(stdout);
    if (payload.is_error) throw new Error(String(payload.result ?? 'claude reported an error'));
    if (typeof payload.result !== 'string') throw new Error('claude JSON output had no string result');
    return payload.result;
  },
};
