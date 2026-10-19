import { z } from "zod";

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
// Logical topic names, never filesystem paths. MEMORY.md is the generated index.
export const MEMORY_TOPIC_SCHEMA = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}\.md$/).refine(value => value !== "memory.md");
const label = z.string().trim().min(1).max(160).refine(value => !/[\r\n\u0000-\u001f\u007f]/.test(value));
export const MEMORY_LIST_SCHEMA = z.strictObject({});
export const MEMORY_READ_SCHEMA = z.strictObject({ topic: MEMORY_TOPIC_SCHEMA });
export const MEMORY_WRITE_SCHEMA = z.strictObject({
  topic: MEMORY_TOPIC_SCHEMA,
  expectedRevision: z.uuid().nullable().describe("null creates a new topic; updates require the current revision from memory_read. Conflicts require re-reading, never blind retry."),
  name: label.optional(),
  description: label.optional(),
  type: z.enum(["user", "feedback", "project", "reference"]).optional(),
  body: z.string().min(1).max(65536).refine(value => value.trim().length > 0 && !value.includes("\0")),
});
export const MEMORY_FORGET_SCHEMA = z.strictObject({ topic: MEMORY_TOPIC_SCHEMA, expectedRevision: z.uuid() });
export type MemoryWrite = z.infer<typeof MEMORY_WRITE_SCHEMA>;
export type MemoryForget = z.infer<typeof MEMORY_FORGET_SCHEMA>;
export type MemoryDocument = {
  topic: string; revision: string; name: string; description: string;
  type: "user" | "feedback" | "project" | "reference"; body: string;
};
