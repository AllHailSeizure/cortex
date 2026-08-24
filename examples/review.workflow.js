export const meta = {
  name: 'review-changes',
  description: 'Review the working tree across dimensions, then verify each finding',
  phases: [
    { title: 'Review', detail: 'one agent per review dimension' },
    { title: 'Verify', detail: 'adversarially check each finding' },
  ],
};

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'summary'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

const DIMENSIONS = [
  { key: 'correctness', prompt: 'Review the uncommitted changes for logic errors and broken edge cases.' },
  { key: 'security', prompt: 'Review the uncommitted changes for injection, path traversal, and secret handling issues.' },
];

phase('Review');

const reviewed = await pipeline(
  DIMENSIONS,
  (dimension) =>
    agent(dimension.prompt, {
      label: `review:${dimension.key}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
    }),
  (review, dimension) =>
    parallel(
      (review?.findings ?? []).map((finding) => () =>
        agent(
          `Try to refute this review finding. Default to real=false if you cannot confirm it.\n\n${finding.file}: ${finding.summary}`,
          { label: `verify:${dimension.key}:${finding.file}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ ...finding, dimension: dimension.key, verdict })),
      ),
    ),
);

const confirmed = reviewed
  .flat()
  .filter(Boolean)
  .filter((finding) => finding.verdict?.real);

log(`${confirmed.length} confirmed finding(s)`);

return { confirmed };
