export type HarnessId = "codex" | "claude" | "pi";

export const HARNESS_LABELS: Record<HarnessId, string> = {
  codex: "Codex",
  claude: "Claude",
  pi: "Pi / OpenRouter",
};

export function isHarnessId(v: string): v is HarnessId {
  return v === "codex" || v === "claude" || v === "pi";
}
