import * as service from "../business/agent/admission.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
export function resolveChatAgentConfiguration(input: Parameters<typeof service.resolveChatAgentConfiguration>[1]) {
  return businessCall(() => service.resolveChatAgentConfiguration(runtimeDependencies(), input));
}
export const buildChatAgentInstructions = service.buildChatAgentInstructions;
