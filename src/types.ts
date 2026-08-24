export type PhaseMeta = {
  title: string;
  detail?: string;
  model?: string;
};

export type WorkflowMeta = {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: PhaseMeta[];
};

export type AgentOptions = {
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  retries?: number;
};

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
  [key: string]: unknown;
};

export type AgentRequest = {
  id: number;
  prompt: string;
  label: string;
  phase: string;
  model?: string;
  schema?: JsonSchema;
  cwd: string;
  timeoutMs: number;
};

export type AgentResult = {
  id: number;
  label: string;
  phase: string;
  ok: boolean;
  attempts: number;
  durationMs: number;
  output: unknown;
  error?: string;
};

export type RunOptions = {
  scriptPath: string;
  adapter: string;
  args?: unknown;
  cwd: string;
  concurrency: number;
  model?: string;
  timeoutMs: number;
  retries: number;
  dryRun: boolean;
  journalDir?: string;
  quiet: boolean;
};
