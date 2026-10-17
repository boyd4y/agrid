/** Thin HTTP client → POST /api/commands (same gate as UI + agents) */
import type { CommandName } from "@tabdo/shared";
export type { CommandName } from "@tabdo/shared";

const API_URL = (
  process.env.TABDO_API_URL ||
  process.env.TABLE_API_URL ||
  "http://localhost:3001"
).replace(/\/$/, "");
const API_KEY = process.env.TABDO_API_KEY || process.env.TABLE_API_KEY || "";

export async function callCommand(
  command: CommandName,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.TABDO_WORKSPACE_ID) headers["X-Workspace-Id"] = process.env.TABDO_WORKSPACE_ID;
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_URL}/api/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command, input }),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };

  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.result;
}

export function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}
