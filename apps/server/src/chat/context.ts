import * as service from "@tabdo/backend/chat/context";
import type { Actor } from "../auth/actor.js";
import { getReport } from "../reports/service.js";
import { runtimeDependencies, backendCall } from "../services/backend-facade.js";
export { chatContextSchema, contextResourceKey, type ChatContext } from "@tabdo/backend/chat/context-schema";

export function resolveChatContext(input: unknown, actor: Actor) {
  return backendCall(() => service.resolveChatContext({ ...runtimeDependencies(), loadReport: getReport }, input, actor));
}
