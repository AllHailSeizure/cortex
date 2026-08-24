export type Semaphore = {
  acquire: () => Promise<() => void>;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function createSemaphore(limit: number): Semaphore {
  const max = Math.max(1, Math.floor(limit));
  const waiters: Array<() => void> = [];
  let active = 0;

  const release = () => {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  };

  const acquire = () =>
    new Promise<() => void>((resolve) => {
      const grant = () => {
        active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          release();
        });
      };
      if (active < max) grant();
      else waiters.push(grant);
    });

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    const done = await acquire();
    try {
      return await fn();
    } finally {
      done();
    }
  };

  return { acquire, run };
}
