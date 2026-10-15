import type { BackgroundWakeup } from "../../business/background.js";
import { createAutomationControlQueue } from "./queues.js";

/** Post-commit hints only. Outbox and the safety sweep cover a lost notification.
 * Short-lived, batched publishers leave no idle API connection or shutdown handle. */
export function createAutomationNotifier() {
  const pending = new Map<string, BackgroundWakeup>();
  let active: Promise<void> | undefined;
  function start() {
    active ??= Promise.resolve().then(publish)
      .catch(error => console.error("[worker:wakeup] publication failed; durable recovery retained", error))
      .finally(() => { active = undefined; if (pending.size) start(); });
  }
  async function publish() {
    while (pending.size) {
      const batch = [...pending.values()]; pending.clear();
      const queue = createAutomationControlQueue();
      try {
        await Promise.all(batch.map(body => queue.publish({ id: crypto.randomUUID(), body })));
      } catch (error) { console.error("[worker:wakeup] notification failed; durable recovery retained", error); }
      finally { await queue.close().catch(error => console.error("[worker:wakeup] close failed", error)); }
    }
  }
  return {
    notify(wakeup: BackgroundWakeup) {
      pending.set(`${wakeup.kind}:${"threadId" in wakeup ? wakeup.threadId : ""}`, wakeup);
      start();
    },
    async drain() { while (active) await active; },
  };
}
