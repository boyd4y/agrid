import type { Server } from "node:http";
export function createNativeModelFixture(selected: "codex" | "claude" | "pi", toolName?: string, toolInput?: Record<string, unknown>): {
  model: Server; bodies: unknown[]; errors: string[]; firstReply: string; secondReply: string; nextTurn(): void; readonly requests: number;
};
