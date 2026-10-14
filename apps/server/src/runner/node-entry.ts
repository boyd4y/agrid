import { runNodeExecution } from "@tabdo/platform-node/execution/node-worker";
import { withNodeResources, nodeJobResources } from "../resources/node.js";
import { executeAcceptedNativeRun } from "./execute.js";

let exitCode = 0;
try {
  await runNodeExecution(async (request, signal) => {
    if (!request.reference || typeof request.reference !== "object" || Array.isArray(request.reference)
      || !("executionId" in request.reference) || request.reference.executionId !== request.id) throw new Error("Invalid private execution reference");
    await withNodeResources(() => executeAcceptedNativeRun(request.id, signal));
  });
} catch {
  // The private repository records details; never echo launch secrets or SDK configuration.
  exitCode = 1;
} finally {
  await nodeJobResources.database.close();
}
// Waiting client-tool bridges may keep the pinned native SDK alive. Its journal,
// workspace and accepted answers have committed before this complete process exits.
process.exit(exitCode);
