import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { resolveChatAgentConfiguration, buildChatAgentInstructions } from "@tabdo/backend/agent/admission";
import { resolveChatContext } from "@tabdo/backend/chat/context";
import { getReport } from "@tabdo/backend/reports/service";
import { resolveAgentSkills } from "@tabdo/backend/skills/runtime";
import { resolvePiModelMetadata } from "@tabdo/backend/agent/model-metadata";
import { resolveNativeConfiguration, resolvePiModelId } from "@tabdo/backend/agent/runtime-configuration";
import type { RuntimeEnvironment } from "@tabdo/backend/agent/contracts";
import { createTableTools } from "@tabdo/backend/agent/tools/index";
import type { LoadedNativeExecution } from "@tabdo/backend/agent/executions";
import type { GatewayServices } from "@tabdo/backend/agent/gateway";
import { ServiceError } from "@tabdo/backend/errors";
import type { ProductScope } from "./product-scope.js";

export type ResolvedAgentConfiguration = Awaited<ReturnType<typeof resolveChatAgentConfiguration>>;
export type ResolvedChatContext = Awaited<ReturnType<typeof resolveChatContext>>;

export function resolveProductContext(scope: ProductScope, input: unknown, actor: LoadedNativeExecution["actor"]) {
  return resolveChatContext({ ...scope.runtime,loadReport: (id,organizationId) => getReport(scope.runtime,id,organizationId) },input,actor);
}

/** Native SDK construction remains in the Sandbox; this prepares only product settings and documents. */
export async function prepareProductAgent(scope: ProductScope, env: RuntimeEnvironment, configuration: ResolvedAgentConfiguration, context: ResolvedChatContext) {
  const { profile,harness,mode,disabledTools,tableId } = configuration;
  const modelId = harness === "pi" ? resolvePiModelId(configuration.modelId, env) : configuration.modelId;
  const { skills,instructions: skillInstructions } = await resolveAgentSkills({ ...scope.runtime,builtins: scope.builtins },profile.organizationId,profile.persona?.skillNames);
  const { agentsDocument,system } = buildChatAgentInstructions({ ...configuration,modelId },context,skillInstructions);
  const piModel = harness === "pi" ? await resolvePiModelMetadata(modelId,env) : undefined;
  resolveNativeConfiguration({ harness,mode,modelId,piModel,env });
  const definitions: ToolSet = createTableTools(scope.commands,tableId,profile.organizationId,undefined);
  const toolDefinitions = await Promise.all(Object.entries(definitions).map(async ([name,definition]) => ({
    name,description: typeof definition.description === "string" ? definition.description : name,inputSchema: await asSchema(definition.inputSchema).jsonSchema,
  })));
  return { harness,modelId,piModel,instructions: system,agentsDocument,skills,disabledTools,toolDefinitions };
}

export async function prepareProductExecution(scope: ProductScope, env: RuntimeEnvironment, loaded: LoadedNativeExecution) {
  const context = await resolveProductContext(scope,loaded.execution.input.context,loaded.actor);
  const configuration = await resolveChatAgentConfiguration(scope.runtime,{ actor: loaded.actor,agentId: loaded.profile.memberId,
    context,boundTableId: loaded.execution.input.boundTableId });
  if (configuration.harness !== loaded.record.harness || configuration.mode !== loaded.record.mode) throw new ServiceError(409,{ message: "原生运行配置已改变，请新建对话" });
  return prepareProductAgent(scope,env,configuration,context);
}

/** Gateway holds lease, membership and durable tool receipt in the supplied transaction. */
export async function executeProductTool(scope: ProductScope, input: Parameters<GatewayServices["executeTool"]>[0]) {
  const { loaded,name,tx,toolCallId } = input;
  const disabled = loaded.profile.persona?.disabledTools ?? [];
  if (disabled.includes(name)) throw new ServiceError(403,{ message: "工具已关闭，无法执行" });
  const tableId = loaded.execution.input.context.tableId;
  const definitions: ToolSet = createTableTools(scope.commands,loaded.execution.input.boundTableId ?? (typeof tableId === "string" ? tableId : undefined),
    loaded.actor.organizationId,loaded.actor.userId,tx);
  const definition = definitions[name];
  if (!definition?.execute) throw new ServiceError(400,{ message: "未知的平台工具" });
  const schema = asSchema(definition.inputSchema);
  const validation = await schema.validate?.(input.input);
  if (!validation?.success) throw new ServiceError(400,{ message: "工具输入格式无效" });
  const execute = definition.execute as (value: unknown,options: { toolCallId: string; messages: never[]; context: undefined }) => Promise<unknown>;
  const result = await execute(validation.value,{ toolCallId,messages: [],context: undefined });
  return result === undefined ? null : JSON.parse(JSON.stringify(result));
}
