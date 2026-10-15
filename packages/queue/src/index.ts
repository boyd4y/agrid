/** Application-generated identity, stable across duplicate delivery. */
export type QueueMessage<T> = Readonly<{ id: string; body: T }>;
export interface QueuePublisher<T> {
  /** Acknowledges transport acceptance, not completion of business effects. */
  publish(message: QueueMessage<T>): Promise<void>;
  close?(): Promise<void>;
}
export type QueueDelivery<T> = QueueMessage<T> & Readonly<{ attempt: number; attempts: number }>;
export type QueueFailure<T> = Readonly<{ delivery: QueueDelivery<T>; error: Error; terminal: boolean }>;
export type QueueDisposition =
  | Readonly<{ type: "complete" }>
  | Readonly<{ type: "defer"; delayMs: number }>
  | Readonly<{ type: "retry"; error: Error; permanent: boolean }>;
export type QueueConsumerOptions<T> = Readonly<{
  concurrency: number;
  globalConcurrency: number;
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount?: number;
  process(delivery: QueueDelivery<T>): Promise<QueueDisposition>;
  onFailed?(failure: QueueFailure<T>): Promise<void> | void;
}>;
export interface QueueConsumer {
  readonly ready: Promise<void>;
  pause(): Promise<void>;
  resume(): void;
  close(): Promise<void>;
}
export type QueueStatus = Readonly<{
  name: string;
  counts: Record<string, number>;
  globalConcurrency: number | null;
}>;
export type QueueJob<T> = QueueMessage<T> & Readonly<{ state: string }>;
export interface QueueInspector<T> {
  has(id: string): Promise<boolean>;
  get(id: string): Promise<QueueJob<T> | undefined>;
  status(): Promise<QueueStatus>;
}
export interface QueueTransport<T> extends QueuePublisher<T>, QueueInspector<T> {
  consume(options: QueueConsumerOptions<T>): QueueConsumer;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}
export interface TaskLease {
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}
export type LeaseKeys = Readonly<{ resourceKey: string; groupKey: string }>;
export interface LeaseProvider {
  acquire(keys: LeaseKeys): Promise<TaskLease | null>;
  close(): Promise<void>;
}
export class LeaseOwnershipError extends Error {}

export function parseQueueMessage(input: unknown): QueueMessage<unknown> {
  if (typeof input !== "object" || input === null || !("id" in input)
    || typeof input.id !== "string" || !input.id.trim() || !("body" in input)) {
    throw new Error("Invalid queue message");
  }
  return Object.freeze({ id: input.id, body: input.body });
}
