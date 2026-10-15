/** Drain every in-flight operation before exposing a failure to the caller. */
export async function runBatch<T>(records: readonly T[], concurrency: number, work: (record: T) => Promise<boolean | number>) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError("Invalid batch concurrency");
  let cursor = 0, completed = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(records.length, concurrency) }, async () => {
    while (cursor < records.length) {
      const result = await work(records[cursor++]);
      completed += Number(result);
    }
  }));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return completed;
}
