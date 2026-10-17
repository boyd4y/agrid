import type { DocumentCommand, DocumentCommands, DocumentResults } from "@tabdo/shared";
import { workspaceCacheKey, workspaceHeaders } from "@/lib/workspace-scope";
import i18n from "@/i18n";
export class DocumentApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(i18n.t(`documents:errors.${code}`, { defaultValue: i18n.t("documents:errors.REQUEST_FAILED") })); this.code = code; }
}
export async function documentCommand<K extends DocumentCommand>(command: K, input: DocumentCommands[K], signal?: AbortSignal): Promise<DocumentResults[K]> {
  const scope = workspaceCacheKey();
  const response = await fetch("/api/commands", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...workspaceHeaders() }, body: JSON.stringify({ command, input }), signal }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new DocumentApiError("REQUEST_FAILED");
  });
  if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError");
  const body = await response.json();
  if (!response.ok) throw new DocumentApiError(body.code ?? "REQUEST_FAILED");
  return body.result;
}
