import { restoreWorkspace as restorePortableWorkspace, type WorkspaceSnapshot } from "@tabdo/agent-runtime/workspace";
import { createDiskWorkspace } from "@tabdo/platform-node/sandbox/workspace";
export { snapshotWorkspace, workspaceSnapshotSchema, type WorkspaceSnapshot } from "@tabdo/agent-runtime/workspace";

/** Compose a fresh owned directory for each cold native execution. */
export function restoreWorkspace(snapshot?: WorkspaceSnapshot | null) {
  return restorePortableWorkspace(snapshot, { createWorkspace: createDiskWorkspace });
}
