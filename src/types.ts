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
  /**
   * Repo-root-relative, gitignore-syntax patterns naming everything this call may see. Cortex
   * runs it in a sparse worktree containing only these paths, so anything else is absent from
   * disk rather than merely discouraged. Omit to run against the full run worktree.
   */
  cone?: string[];
  /** Named permission profile ('editor' | 'reader') copied in as the backend's own config. */
  profile?: string;
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
  cone?: string[];
  profile?: string;
};

/** What the backend produced, plus what it actually changed on disk. */
export type AgentOutcome = {
  text: string;
  changedFiles?: string[];
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
  /** Files this agent changed, for the red report's agent-to-file map. */
  changedFiles?: string[];
};

/** One orchestrator-run check — see verify() in the workflow runtime. */
export type CheckResult = {
  command: string;
  ok: boolean;
  code: number | null;
  output: string;
  durationMs: number;
};

/** Green unless a check failed or an agent failed. A red run is reported, never auto-repaired. */
export type RunStatus = 'green' | 'red';

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
  worktree?: boolean;
};
