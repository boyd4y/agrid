import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import type { SnapshotWorkspace } from "@tabdo/agent-runtime/workspace";

// Lifecycle handles only: the SDK continuation and accepted answers stay in DB.
// Pi 1.0.151's destructive suspension cannot preserve a pending client's answer.
type WarmSandbox = { sandbox: HarnessV1NetworkSandboxSession; fs?: SnapshotWorkspace; discard: () => Promise<void> };
const pending = new Map<string, WarmSandbox>();

export function parkQuestionSandbox(runtimeId: string, opened: WarmSandbox) { pending.set(runtimeId, opened); }
export function hasQuestionSandbox(runtimeId: string) { return pending.has(runtimeId); }
export function takeQuestionSandbox(runtimeId: string) {
  const opened = pending.get(runtimeId);
  pending.delete(runtimeId);
  return opened;
}

/** Explicit deletion only; no timeout or invented expiry for human answers. */
export async function discardQuestionSandbox(runtimeId: string) {
  await takeQuestionSandbox(runtimeId)?.discard();
}
