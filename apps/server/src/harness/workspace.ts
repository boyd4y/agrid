import { restoreWorkspace as restorePortableWorkspace, type WorkspaceSnapshot } from "@tabdo/agent-runtime/workspace";
export { snapshotWorkspace, workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/agent-runtime/workspace";

/** Preserve the existing Node filesystem's Buffer representation at composition. */
export function restoreWorkspace(snapshot?: WorkspaceSnapshot | null) {
  return restorePortableWorkspace(snapshot, { createBytes: bytes => Buffer.from(bytes) });
}
