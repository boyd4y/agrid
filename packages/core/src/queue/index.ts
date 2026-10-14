/** Application-generated identity; it is not the provider's message ID. */
export type QueueMessage<T> = Readonly<{ id: string; body: T }>;

/** Publication only acknowledges provider acceptance, not business completion. */
export interface QueuePublisher<T> {
  publish(message: QueueMessage<T>): Promise<void>;
  close?(): Promise<void>;
}

/** Validate the transport envelope. Payload validation belongs to the caller. */
export function parseQueueMessage(input: unknown): QueueMessage<unknown> {
  if (typeof input !== "object" || input === null || !("id" in input)
    || typeof input.id !== "string" || !input.id.trim() || !("body" in input)) {
    throw new Error("Invalid queue message");
  }
  return Object.freeze({ id: input.id, body: input.body });
}
