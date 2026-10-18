import type { BlogCommand, BlogCommands, BlogResults } from "@tabdo/shared";
import { workspaceCacheKey, workspaceHeaders } from "@/lib/workspace-scope";
import { notifyDataChanged } from "@/lib/data-changes";
import i18n from "@/i18n";
export async function blogCommand<K extends BlogCommand>(command: K, input: BlogCommands[K], signal?: AbortSignal): Promise<BlogResults[K]> {
  const scope = workspaceCacheKey();
  const response = await fetch("/api/commands", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...workspaceHeaders() }, body: JSON.stringify({ command, input }), signal }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(i18n.t("blogs:errors.REQUEST_FAILED"));
  });
  if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError");
  const body = await response.json();
  if (!response.ok) throw new Error(i18n.t(`blogs:errors.${body.code ?? "REQUEST_FAILED"}`, { defaultValue: i18n.t("blogs:errors.REQUEST_FAILED") }));
  if (command === "createBlog") notifyDataChanged(body.result.config.tableId);
  if (command === "startBlogArticle") notifyDataChanged(body.result.tableId);
  return body.result;
}
