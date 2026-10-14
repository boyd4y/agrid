import { z } from "zod";

/** Private proof written only before an accepted question continuation enters the SDK. */
export const QUESTION_NOT_INVOKED = "question-not-invoked-v1";

// Private persisted workspace shape; restoration policy stays with the runtime.
const snapshotEntry = z
  .object({
    path: z.string().startsWith("/").max(4096),
    type: z.enum(["directory", "file", "symlink"]),
    content: z.string().optional(),
    target: z.string().optional(),
    mode: z.number().int().min(0).max(0o7777),
  })
  .strict();
export const workspaceSnapshotSchema = z.array(snapshotEntry).max(4000);
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
