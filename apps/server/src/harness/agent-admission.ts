import * as service from "@tabdo/backend/agent/admission";
import { runtimeDependencies, backendCall } from "../services/backend-facade.js";
export function resolveChatAgentConfiguration(input: Parameters<typeof service.resolveChatAgentConfiguration>[1]) {
  return backendCall(() => service.resolveChatAgentConfiguration(runtimeDependencies(), input));
}
export const buildChatAgentInstructions = service.buildChatAgentInstructions;
