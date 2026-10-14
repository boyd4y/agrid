import { and,eq,desc } from "drizzle-orm";
import { agentExecutions,agentRuns,agentRuntimeSessions } from "@tabdo/backend/schema";
import { createRelay } from "@tabdo/backend/automation/outbox";
import { ServiceError } from "@tabdo/backend/errors";
import { resolveActor } from "@tabdo/backend/auth/actor";
import { readNativeExecutionOutput } from "@tabdo/backend/agent/executions";
import { createCloudflarePublisher } from "@tabdo/platform-cloudflare/queue";
import { createCloudflareContainerExecution } from "@tabdo/platform-cloudflare/execution/container";
import { createProductChatHandlers } from "./chat.js";
import { prepareProductAgent } from "./agent-preparation.js";
import { executionJob,type ProductJob } from "./queue.js";
import { acquireResources } from "./resources.js";
import { runtimeEnvironment,piStatusConfiguration,type ProductEnvironment } from "./configuration.js";
import type { ExecutionReference } from "./contracts.js";

export function program(env: ProductEnvironment) {
  const configuration = runtimeEnvironment(env);
  const variables: Record<string,string> = {};
  for (const [key,value] of Object.entries(configuration)) {
    if (!value) continue;
    if (env.ENVIRONMENT === "development" && key.endsWith("BASE_URL")) {
      const address = new URL(value);
      if (["localhost","127.0.0.1","[::1]"].includes(address.hostname)) address.hostname = "host.docker.internal";
      variables[key]=address.toString();
    } else variables[key]=value;
  }
  return { imageKey:"runner",entrypoint:["sleep","infinity"],command:["node","/workspace/apps/cloudflare/sandbox/runtime/dist/entry.mjs"],
    cwd:"/workspace",enableInternet:true,env:variables };
}
export const publisher = (env: ProductEnvironment) => createCloudflarePublisher<ProductJob>(env.JOBS);
export async function startExecution(env: ProductEnvironment,executionId: string) {
  const adapter = createCloudflareContainerExecution({ resolve:id => env.EXECUTIONS.getByName(`execution:${id}`) });
  try { await adapter.start({ id:executionId,reference:{executionId} }); }
  finally { await adapter.close(); }
}
export async function dispatch(env: ProductEnvironment,reference: ExecutionReference) {
  await publisher(env).publish(executionJob(reference.executionId));
}
export async function subscribe(env: ProductEnvironment,request: Request,reference: ExecutionReference) {
  const address = new URL("https://session.internal/stream");
  for (const [key,value] of Object.entries(reference)) address.searchParams.set(key,value);
  const headers = new Headers();
  for (const key of ["cookie","authorization","last-event-id"]) { const value=request.headers.get(key);if(value) headers.set(key,value); }
  return env.SESSIONS.getByName(`thread:${reference.threadId}`).fetch(new Request(address,{headers}));
}
/** Cancellation was already committed. Give SDK polling/checkpoint cleanup bounded time, then stop compute. */
export async function stopCompute(env: ProductEnvironment,reference: ExecutionReference) {
  const deadline = Date.now()+8000;
  while (Date.now()<deadline) {
    const scope = await acquireResources(env);
    let settled = false;
    try {
      const [execution] = await scope.runtime.database.select({status:agentExecutions.status}).from(agentExecutions).where(eq(agentExecutions.id,reference.executionId));
      settled = !execution || execution.status === "settled";
    } finally { await scope.close(); }
    if (settled) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  await env.EXECUTIONS.getByName(`execution:${reference.executionId}`).terminateExecution(reference.executionId);
}
export async function cleanupCompute(env: ProductEnvironment,id: string) {
  await new Promise(resolve=>setTimeout(resolve,300));
  await env.EXECUTIONS.getByName(`execution:${id}`).terminateExecution(id);
}
/** Only a wakeup; output and access still come from the durable PG cursor. */
export async function notifyOutput(env: ProductEnvironment,executionId: string) {
  const scope = await acquireResources(env);
  try {
    const [reference] = await scope.runtime.database.select({executionId:agentExecutions.id,runId:agentRuns.id,threadId:agentRuns.threadId})
      .from(agentExecutions).innerJoin(agentRuns,eq(agentRuns.id,agentExecutions.runId)).where(eq(agentExecutions.id,executionId));
    if (reference) await env.SESSIONS.getByName(`thread:${reference.threadId}`).notify(reference);
  } finally { await scope.close(); }
}
export async function acquire(env: ProductEnvironment) {
  const scope = await acquireResources(env);
  return { ...scope, async discardRuntime(_runtimeId: string,executionIds: readonly string[] = []) {
    await Promise.all(executionIds.map(id => env.EXECUTIONS.getByName(`execution:${id}`).terminateExecution(id)));
  } };
}
export async function cancelRun(env: ProductEnvironment,request: Request,threadId: string,runId: string) {
  const scope = await acquire(env);
  let reference: ExecutionReference;
  try {
    const actor = await resolveActor(request,scope.identity);
    if (!actor?.organizationId) throw new ServiceError(401,{message:"未授权"});
    const [execution] = await scope.runtime.database.select({ executionId:agentExecutions.id,runId:agentRuns.id,threadId:agentRuns.threadId })
      .from(agentExecutions).innerJoin(agentRuns,eq(agentRuns.id,agentExecutions.runId))
      .where(and(eq(agentRuns.id,runId),eq(agentRuns.threadId,threadId))).orderBy(desc(agentExecutions.acceptedAt),desc(agentExecutions.id)).limit(1);
    if (!execution) throw new ServiceError(404,{message:"执行记录不存在"});
    reference=execution;
    await readNativeExecutionOutput(scope.runtime,{executionId:execution.executionId,expected:execution,actor,after:0,limit:1});
  } finally { await scope.close(); }
  const credentials={cookie:request.headers.get("cookie")??undefined,authorization:request.headers.get("authorization")??undefined};
  await env.SESSIONS.getByName(`thread:${threadId}`).cancel({reference,credentials});
  return {ok:true};
}
export const chat = createProductChatHandlers<ProductEnvironment>({
  acquire,subscribe,
  async dispatch(env,reference) {
    // The accepted receipt is already durable. Interactive chat can start its
    // DO immediately instead of waiting for a background queue batch window.
    try { await startExecution(env,reference.executionId); }
    catch { await dispatch(env,reference); }
  },
  async prepare(env,scope,input) {
    if(input.configuration.harness!=="pi" || input.configuration.mode!=="local") throw new ServiceError(503,{message:"此执行环境当前支持 Pi 本地工作区；其他原生执行模式尚未接入"});
    await prepareProductAgent(scope,runtimeEnvironment(env),input.configuration,input.context);
  },
  validateQuestions:(env,pairs)=>env.VALIDATORS.getByName(`validation:${crypto.randomUUID()}`).validateQuestions(pairs),
  status(env) {
    const { configured, model, provider } = piStatusConfiguration(runtimeEnvironment(env));
    return { mode:configured?"live":"unconfigured",providers:[],harnesses:[
      {id:"pi",label:"Pi",available:configured,provider,models:[{id:model,label:model}],defaultModel:model,runtimeModes:["local"],defaultRuntime:"local",hint:configured?undefined:"请配置 DeepSeek 或 Pi 模型提供商"},
      ...[{id:"codex",label:"Codex"},{id:"claude",label:"Claude Code"}].map(value=>({...value,available:false,models:[],defaultModel:"__harness_default__",runtimeModes:["sandbox"],defaultRuntime:"sandbox",hint:"此执行环境尚未接入"})),
    ] };
  },
});

/** Best-effort post-commit wake. Cron repairs missed wakeups from durable PG outbox. */
export async function relayOutbox(env: ProductEnvironment) {
  const scope = await acquire(env);
  try {
    await createRelay({database:scope.runtime.database,uuid:scope.runtime.uuid,publisher:publisher(env),
      batchSize:25,leaseMs:30000,concurrency:8,logger:{error:(_event,id)=>console.warn("queue.outbox.pending",id)}}).tick();
  } finally { await scope.close(); }
}
