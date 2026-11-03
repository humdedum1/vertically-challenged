/** Runs tasks one at a time, so read-modify-write cycles can't lose each other's changes. A failed task rejects for its caller only. */
export function createWriteQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
}
