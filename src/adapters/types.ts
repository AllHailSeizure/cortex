import type { AgentRequest } from '../types.ts';

export type AdapterInvocation = {
  command: string;
  args: string[];
  stdin?: string;
};

export type Adapter = {
  name: string;
  binary: string;
  verified: boolean;
  build: (request: AgentRequest, extraArgs: string[]) => AdapterInvocation;
  parse: (stdout: string) => string;
};
