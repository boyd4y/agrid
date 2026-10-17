import * as service from "../business/chat/context.js";
import type { Actor } from "../auth/actor.js";
import { getReport } from "../business/reports/service.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
export { chatContextSchema, contextResourceKey, type ChatContext } from "../business/chat/context-schema.js";

export function resolveChatContext(input: unknown, actor: Actor) {
  const deps = { ...runtimeDependencies(), workspaceId: actor.workspaceId };
  return businessCall(() => service.resolveChatContext({ ...deps, loadReport: (id, org) => getReport(deps, id, org) }, input, actor));
}
