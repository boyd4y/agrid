import { ROW_ATTACHMENT_SCHEMAS, type RowAttachmentCommands, type RowAttachmentResults } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { executeDocument, type DocumentCaller } from "../documents/service.js";
export async function executeRowAttachment<K extends keyof RowAttachmentCommands>(deps: CommandDependencies, caller: DocumentCaller, command: K, raw: unknown, transaction?: Transaction): Promise<RowAttachmentResults[K]> {
  const { target, ...input } = ROW_ATTACHMENT_SCHEMAS[command].parse(raw);
  return inTransaction(deps, transaction, async tx => {
    if (command === "uploadRowAttachment") {
      const file = await executeDocument(deps, caller, "uploadDocumentImage", input, tx);
      return { ...file, bodyVersion: file.bodyVersion ?? ("expectedVersion" in input ? input.expectedVersion || 1 : 1) } as RowAttachmentResults[K];
    }
    return await executeDocument(deps, caller, "getDocumentImage", input, tx) as RowAttachmentResults[K];
  });
}
type Identity = { organizationId?: string; actorId?: string };
function member(input: Identity): DocumentCaller {
  if (!input.organizationId || !input.actorId) throw new Error("Current membership is required");
  return { kind: "member", organizationId: input.organizationId, actorId: input.actorId };
}
export const uploadRowAttachment = (deps: CommandDependencies, input: RowAttachmentCommands["uploadRowAttachment"] & Identity, tx?: Transaction) => {
  const { organizationId, actorId, ...raw } = input;
  return executeRowAttachment(deps, member(input), "uploadRowAttachment", raw, tx);
};
export const getRowAttachment = (deps: CommandDependencies, input: RowAttachmentCommands["getRowAttachment"] & Identity, tx?: Transaction) => {
  const { organizationId, actorId, ...raw } = input;
  return executeRowAttachment(deps, member(input), "getRowAttachment", raw, tx);
};
