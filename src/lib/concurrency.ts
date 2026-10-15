/**
 * A gate that lets at most `limit` jobs run at once, for jobs that turn up
 * one by one rather than as a list: the rest wait their turn, first come
 * first served.
 */
export function createLimiter(limit: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async job => {
    if (running >= limit) {
      // A job that finishes hands its place straight to this one, so nothing turning up meanwhile can take it.
      await new Promise<void>(resolve => {
        waiting.push(resolve);
      });
    } else {
      running += 1;
    }
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        running -= 1;
      }
    }
  };
}
