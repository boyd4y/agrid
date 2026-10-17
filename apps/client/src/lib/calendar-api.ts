import type { CalendarCommand, CalendarCommands, CalendarResults } from "@tabdo/shared";
import { workspaceHeaders, workspaceCacheKey } from "@/lib/workspace-scope";
import i18n from "@/i18n";
export class CalendarApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export async function calendarCommand<K extends CalendarCommand>(command: K, input: CalendarCommands[K], signal?: AbortSignal): Promise<CalendarResults[K]> {
  const scope = workspaceCacheKey();
  const response = await fetch("/api/commands", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...workspaceHeaders() }, body: JSON.stringify({ command, input }), signal }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new CalendarApiError("REQUEST_FAILED", i18n.t("calendar:errors.REQUEST_FAILED"));
  });
  if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError");
  const body = await response.json();
  if (!response.ok) throw new CalendarApiError(body.code ?? "REQUEST_FAILED", i18n.t(`calendar:errors.${body.code ?? "REQUEST_FAILED"}`, { defaultValue: i18n.t("calendar:errors.REQUEST_FAILED") }));
  return body.result;
}
