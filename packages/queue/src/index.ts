/** Application-generated identity; it is not the provider's message ID. */
export type QueueMessage<T> = Readonly<{ id: string; body: T }>;

/** Publication only acknowledges provider acceptance, not business completion. */
export interface QueuePublisher<T> {
  publish(message: QueueMessage<T>): Promise<void>;
  close?(): Promise<void>;
}

/** Business code requests delivery behavior without depending on BullMQ errors. */
export class QueuePermanentError extends Error {}
export class QueueDeferredError extends Error {
  constructor(readonly delayMs: number) {
    super("Queue delivery deferred");
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError("Invalid queue delay");
  }
}
export type QueueDelivery<T> = QueueMessage<T> & Readonly<{ attempt: number; attempts: number }>;
export type QueueFailure<T> = Readonly<{ delivery: QueueDelivery<T>; error: Error; terminal: boolean }>;

/** Validate the transport envelope. Payload validation belongs to the caller. */
export function parseQueueMessage(input: unknown): QueueMessage<unknown> {
  if (typeof input !== "object" || input === null || !("id" in input)
    || typeof input.id !== "string" || !input.id.trim() || !("body" in input)) {
    throw new Error("Invalid queue message");
  }
  return Object.freeze({ id: input.id, body: input.body });
}
