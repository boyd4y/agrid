import * as service from "../business/chat/context.js";
import type { Actor } from "../auth/actor.js";
import { getReport } from "../reports/service.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
export { chatContextSchema, contextResourceKey, type ChatContext } from "../business/chat/context-schema.js";

export function resolveChatContext(input: unknown, actor: Actor) {
  return businessCall(() => service.resolveChatContext({ ...runtimeDependencies(), loadReport: getReport }, input, actor));
}
