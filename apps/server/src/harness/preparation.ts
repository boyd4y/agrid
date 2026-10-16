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
  boundTableId?: string;
  validateInput?: (harness: HarnessId) => void;
  env?: RuntimeEnvironment;
}) {
  const { actor, context } = options;
  const configuration = await resolveChatAgentConfiguration(options);
  const { profile, harness, mode, disabledTools, tableId } = configuration;
  const env = options.env ?? process.env;
  const modelId = harness === "pi" ? resolvePiModelId(configuration.modelId, env) : configuration.modelId;
  const skillContext = await resolveAgentSkills(actor.organizationId, profile.persona?.skillNames, siteSdkUrl(env));
  const tools = createTableTools(tableId, actor.organizationId, actor.userId);
  const { agentsDocument, system } = buildChatAgentInstructions({ ...configuration, modelId }, context, skillContext.instructions);
  // Reject unavailable configuration before saving user input or claiming a Run.
  const piModel = harness === "pi" ? await resolvePiModelMetadata(modelId, env) : undefined;
  resolveNativeConfiguration({ harness, mode, modelId, piModel, env });
  return { profile, harness, modelId, mode, disabledTools, skills: skillContext.skills, tools, agentsDocument, system, piModel };
}
