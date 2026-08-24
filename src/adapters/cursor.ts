import type { Adapter } from './types.ts';

export const cursorAdapter: Adapter = {
  name: 'cursor',
  binary: 'cursor-agent',
  verified: false,
  build(request, extraArgs) {
    const args = ['-p', '--output-format', 'json'];
    if (request.model) args.push('--model', request.model);
    args.push(...extraArgs);
    return { command: 'cursor-agent', args, stdin: request.prompt };
  },
  parse(stdout) {
    const payload = JSON.parse(stdout);
    const result = payload.result ?? payload.text ?? payload.response;
    if (typeof result !== 'string') throw new Error('cursor-agent JSON output had no string result');
    return result;
  },
};
