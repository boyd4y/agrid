import { parseAutomationDelivery, type AutomationDelivery, type QueuePublisher } from "@tabdo/core";

export function createAutomationPublisher(binding: Queue<AutomationDelivery>): QueuePublisher<AutomationDelivery> {
  return Object.freeze({
    async publish(delivery: AutomationDelivery) {
      await binding.send(parseAutomationDelivery(delivery), { contentType: "json" });
    },
  });
}

/** The callback must persist acceptance before resolving; never await a complete agent turn here. */
export async function acceptAutomationBatch(
  batch: MessageBatch<unknown>,
  accept: (delivery: AutomationDelivery, attempt: number) => Promise<void>,
  onError: (error: unknown, messageId: string) => void = (error, id) => console.error("[queue:accept]", id, error),
): Promise<void> {
  let cursor = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, batch.messages.length) }, async () => {
    while (cursor < batch.messages.length) {
      const message = batch.messages[cursor++];
      try {
        await accept(parseAutomationDelivery(message.body), message.attempts);
        message.ack();
      } catch (error) {
        // Invalid messages also retry toward the configured DLQ; never silently discard them.
        message.retry();
        onError(error, message.id);
      }
    }
  }));
  // An error observer may throw. Still finish other in-flight accepts before
  // returning to the platform, so their durable writes/acks are not abandoned.
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
