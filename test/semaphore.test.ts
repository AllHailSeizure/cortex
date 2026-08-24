import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSemaphore } from '../src/semaphore.ts';

test('never exceeds the configured limit', async () => {
  const semaphore = createSemaphore(2);
  let active = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 10 }, () =>
      semaphore.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((done) => setTimeout(done, 5));
        active -= 1;
      }),
    ),
  );

  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('releases the slot when the task throws', async () => {
  const semaphore = createSemaphore(1);
  await assert.rejects(semaphore.run(async () => { throw new Error('boom'); }));
  assert.equal(await semaphore.run(async () => 'next'), 'next');
});
