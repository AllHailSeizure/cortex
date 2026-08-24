export const meta = {
  name: 'fixture',
  description: 'exercises every injected global',
  phases: [{ title: 'Collect' }, { title: 'Summarize' }],
};

const ITEM_SCHEMA = {
  type: 'object',
  required: ['score'],
  properties: { score: { type: 'integer' } },
};

phase('Collect');
log(`args: ${JSON.stringify(args)}`);

const scored = await pipeline(
  args.targets,
  (target) => agent(`score ${target}`, { label: `score:${target}`, schema: ITEM_SCHEMA }),
  (score, target) => ({ target, score: score.score }),
);

phase('Summarize');
const summary = await agent('summarize the scores');

return { scored, summary };
