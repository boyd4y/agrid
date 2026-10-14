import type { UIMessageChunk } from "ai";
import type { NativeRunDurableOutput } from "./execution.js";

/** Bounded buffering decouples native token consumption from persistence RTT.
 * flush() is a persistence barrier, not a fire-and-forget finalizer. */
export function createBatchedOutput(options: {
  writeBatch(chunks: readonly UIMessageChunk[]): Promise<void>;
  flushIntervalMs?: number;
  maxBatchChunks?: number;
  maxBatchBytes?: number;
  maxPendingBytes?: number;
}): NativeRunDurableOutput & { flush(): Promise<void> } {
  const interval = options.flushIntervalMs ?? 50;
  const batchLimit = options.maxBatchChunks ?? 64;
  const batchBytes = options.maxBatchBytes ?? 256 * 1024;
  const pendingLimit = options.maxPendingBytes ?? 2 * 1024 * 1024;
  for (const value of [interval,batchLimit,batchBytes,pendingLimit])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid output buffer limit");
  if (batchLimit > 128 || pendingLimit < batchBytes) throw new TypeError("Invalid output buffer bounds");
  type Entry = { chunk: UIMessageChunk; bytes: number };
  let queue: Entry[] = [], queuedBytes = 0, inFlightBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> | undefined;
  let failed = false, failure: unknown;
  const assertHealthy = () => { if (failed) throw failure; };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer);timer = undefined; };
  function schedule() {
    if (timer !== undefined || sending || failed || !queue.length) return;
    timer = setTimeout(() => { timer = undefined;void send().catch(() => {}); },interval);
  }
  function send(): Promise<void> {
    if (sending) return sending;
    if (failed) return Promise.reject(failure);
    if (!queue.length) return Promise.resolve();
    clearTimer();
    const entries: Entry[] = [];
    let size = 0;
    while (queue.length && entries.length < batchLimit && (!entries.length || size + queue[0].bytes <= batchBytes)) {
      const item = queue.shift()!;entries.push(item);size += item.bytes;
    }
    queuedBytes -= size;inFlightBytes = size;
    const operation = Promise.resolve().then(() => options.writeBatch(entries.map(item => item.chunk)));
    sending = operation.then(() => {
      sending = undefined;inFlightBytes = 0;
      if (queue.length >= batchLimit || queuedBytes >= batchBytes) void send().catch(() => {});
      else schedule();
    },error => {
      failed = true;failure = error;sending = undefined;inFlightBytes = 0;clearTimer();
      // Never replay an ambiguous append. The execution will fail its barrier.
      throw error;
    });
    void sending.catch(() => {});
    return sending;
  }
  return {
    async write(chunk) {
      assertHealthy();
      const bytes = new TextEncoder().encode(JSON.stringify(chunk)).byteLength + 1;
      // Allow one large existing tool result, but do not retain an unbounded
      // number of following chunks behind it while the network is slow.
      while ((queue.length || sending) && queuedBytes + inFlightBytes + bytes > pendingLimit) { await send();assertHealthy(); }
      const previous = queue.at(-1);
      if (previous && (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
        && previous.chunk.type === chunk.type && previous.chunk.id === chunk.id
        && !chunk.providerMetadata && !previous.chunk.providerMetadata) {
        previous.chunk = { ...chunk,delta: previous.chunk.delta + chunk.delta };
        previous.bytes += bytes;queuedBytes += bytes;
      } else { queue.push({chunk,bytes});queuedBytes += bytes; }
      if (queue.length >= batchLimit || queuedBytes >= batchBytes) void send().catch(() => {});
      else schedule();
    },
    async flush() {
      clearTimer();assertHealthy();
      while (sending || queue.length) { await (sending ?? send());assertHealthy(); }
      clearTimer();
    },
  };
}
