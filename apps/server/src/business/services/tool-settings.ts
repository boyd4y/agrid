import { DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS } from "@tabdo/shared";
import { ServiceError } from "../errors.js";

/** Normalize retired/native IDs using the same shared persisted contract. */
export function validateDisabledTools(harness: "pi" | "codex" | "claude", disabledTools: readonly string[] = []): (typeof PLATFORM_TOOL_IDS)[number][] {
  const parsed = DISABLED_TOOLS_SCHEMA.safeParse(disabledTools);
  if (!parsed.success) throw new ServiceError(400, { message: "工具配置包含未知或重复的工具名称" });
  const known = new Set<string>(PLATFORM_TOOL_IDS);
  for (const id of parsed.data) if (!known.has(id)) throw new ServiceError(400, { message: `工具 ${id} 不属于 ${harness} Harness` });
  return parsed.data;
}
