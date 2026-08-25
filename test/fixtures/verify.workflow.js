export const meta = {
  name: 'verify-fixture',
  description: 'runs one orchestrator check whose exit code the caller chooses',
  phases: [{ title: 'Check' }],
};

phase('Check');
const check = await verify(args.command);
if (!check.ok) log('check is red — stopping here rather than sending an agent after it');

return { ok: check.ok, code: check.code };
