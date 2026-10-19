import { admitAgentMemory, listAgentMemory, memoryInstructions } from "../business/agent/memory.js";
import { createMemoryTools } from "../business/agent/tools/memory.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
import { getToolTransaction } from "../ai/execution-context.js";
import { createTableTools } from "../ai/tools.js";
import type { Actor } from "../auth/actor.js";
import type { resolveChatContext } from "../chat/context.js";
import { resolveAgentSkills } from "../skills/runtime.js";
import type { HarnessId, RuntimeEnvironment } from "./contracts.js";
import { resolveChatAgentConfiguration, buildChatAgentInstructions } from "./agent-admission.js";
import { resolvePiModelMetadata } from "./model-metadata.js";
import { resolveNativeConfiguration, resolvePiModelId } from "./runtime-configuration.js";
import { siteSdkUrl } from "../sites/capabilities.js";

/** Node assembly facade: product admission is independently usable without native SDKs. */
export async function prepareNativeChatAgent(options: {
  actor: Actor; agentId: string; context: Awaited<ReturnType<typeof resolveChatContext>>;
  threadId?: string;
  boundTableId?: string;
  validateInput?: (harness: HarnessId) => void;
  env?: RuntimeEnvironment;
}) {
  const { actor, context } = options;
  const env = options.env ?? process.env;
  const configuration = await resolveChatAgentConfiguration({ ...options, env });
  const { profile, harness, mode, provider, disabledTools, tableId } = configuration;
  const modelId = harness === "pi" ? resolvePiModelId(configuration.modelId, env) : configuration.modelId;
  const skillContext = await resolveAgentSkills(actor.organizationId, profile.persona?.skillNames, siteSdkUrl(env));
  const tools = createTableTools(tableId, actor.organizationId, actor.userId, actor.workspaceId);
  const { agentsDocument, system: baseSystem } = buildChatAgentInstructions({ ...configuration, modelId }, context, skillContext.instructions);
  let system = baseSystem;
  if (harness === "pi") {
    const scope = await businessCall(() => admitAgentMemory(runtimeDependencies(), actor, profile.id));
    const { index } = await businessCall(() => listAgentMemory(runtimeDependencies(), scope));
    system = `${baseSystem}\n\n${memoryInstructions(index)}`;
    Object.assign(tools, createMemoryTools(runtimeDependencies, scope, getToolTransaction));
  }
  // Reject unavailable configuration before saving user input or claiming a Run.
  const piModel = harness === "pi" ? await resolvePiModelMetadata(modelId, env) : undefined;
  resolveNativeConfiguration({ harness, mode, provider, modelId, piModel, env });
  return { profile, harness, modelId, mode, provider, disabledTools, skills: skillContext.skills, tools, agentsDocument, system, piModel };
}
