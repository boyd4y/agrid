import type { QueueMessage } from "@tabdo/core/queue";

/** Credentials are input to the authenticated callback, never a cached principal. */
export type AccessCredentials = Readonly<{ cookie?: string; authorization?: string }>;
export type OutputRequest<Reference> = Readonly<{
  reference: Reference; after: number; limit: number; credentials: AccessCredentials;
}>;
export type OutputPage<Chunk, State = unknown> = Readonly<{
  events: readonly Readonly<{ cursor: number; chunk: Chunk }>[];
  terminal: boolean;
  status: State;
}>;

/** References, payloads and business state belong to the application supplying these callbacks. */
export interface SessionServices<Reference, Chunk, State = unknown> {
  readOutput(input: OutputRequest<Reference>): Promise<OutputPage<Chunk, State>>;
  cancel(input: Readonly<{ reference: Reference; credentials: AccessCredentials }>): Promise<void>;
}

/** Acceptance must persist work/dispatch and return without awaiting long-running execution. */
export interface TriggerServices {
  accept(message: QueueMessage<unknown>, attempt: number): Promise<void>;
  wakeSchedules(input: Readonly<{ scheduledTime: number; cron: string }>): Promise<void>;
}

export class CoordinationError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = "CoordinationError";
  }
}

export function parseCursor(value: unknown): number {
  const cursor = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new CoordinationError("Invalid output cursor", 400);
  }
  return cursor;
}
