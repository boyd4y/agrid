import type { UIMessageChunk } from "ai";
import type { QueueMessage } from "@tabdo/queue";

/** Internal references are never a principal and do not grant access. */
export type ExecutionReference = Readonly<{ executionId: string; runId: string; threadId: string }>;
export type AccessCredentials = Readonly<{ cookie?: string; authorization?: string }>;
export type OutputRequest = Readonly<{
  reference: ExecutionReference; after: number; limit: number; credentials: AccessCredentials;
}>;
export type OutputPage = Readonly<{
  events: readonly Readonly<{ cursor: number; chunk: UIMessageChunk }>[];
  terminal: boolean;
  status: "accepted" | "invoking" | "settled";
}>;

/** Every callback revalidates actual credentials and current membership in the platform. */
export interface SessionServices {
  readOutput(input: OutputRequest): Promise<OutputPage>;
  cancel(input: Readonly<{ reference: ExecutionReference; credentials: AccessCredentials }>): Promise<void>;
}

/** Acceptance must persist work/dispatch and return without awaiting the Harness turn. */
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

export function parseExecutionReference(value: unknown): ExecutionReference {
  if (!value || typeof value !== "object") throw new CoordinationError("Invalid execution reference", 400);
  const source = value as Record<string, unknown>;
  for (const key of ["executionId", "runId", "threadId"] as const) {
    if (typeof source[key] !== "string" || !source[key] || source[key].length > 256) {
      throw new CoordinationError("Invalid execution reference", 400);
    }
  }
  return Object.freeze({ executionId: source.executionId as string, runId: source.runId as string, threadId: source.threadId as string });
}

export function parseCursor(value: unknown): number {
  const cursor = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new CoordinationError("Invalid output cursor", 400);
  }
  return cursor;
}
