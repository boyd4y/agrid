import type { CommandInputMap, CommandResultMap, CommandName, DocumentContent } from "@tabdo/shared";
import { workspaceCacheKey, workspaceHeaders } from "@/lib/workspace-scope";
import i18n from "@/i18n";
import { announceApiWrite } from "@/lib/data-changes";
export class RowBodyApiError extends Error {
  readonly code: string;
  constructor(code: string, namespace = "documents") { super(i18n.t(`${namespace}:errors.${code}`, { defaultValue: i18n.t(`${namespace}:errors.REQUEST_FAILED`) })); this.code = code; }
}
export async function rowCommand<K extends CommandName & keyof CommandInputMap & keyof CommandResultMap>(command: K, input: CommandInputMap[K], signal?: AbortSignal): Promise<CommandResultMap[K]> {
  const scope = workspaceCacheKey(), namespace = ["createView", "updateView", "getView", "listViews", "deleteView"].includes(command) ? "blogs" : "documents";
  const init: RequestInit = { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...workspaceHeaders() }, body: JSON.stringify({ command, input }), signal };
  const response = await fetch("/api/commands", init).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RowBodyApiError("REQUEST_FAILED", namespace);
  });
  if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError");
  const result = await response.json();
  if (!response.ok) throw new RowBodyApiError(result.code ?? "REQUEST_FAILED", namespace);
  announceApiWrite("/api/commands", init, result);
  return result.result;
}
export const getRowBody = async (input: { rowId: string }, signal?: AbortSignal) => (await rowCommand("getRow", { rowId: input.rowId, includeBody: true }, signal)).body!;
export const saveRowBody = async (input: { rowId: string; content: DocumentContent; expectedVersion: number; idempotencyKey: string }) => {
  const row = await rowCommand("updateCells", { rowId: input.rowId, body: { content: input.content, expectedVersion: input.expectedVersion }, idempotencyKey: input.idempotencyKey });
  return { version: row.bodyVersion! };
};
