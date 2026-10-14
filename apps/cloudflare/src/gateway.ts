import { z } from "zod";
import { handleExecutionGateway } from "@tabdo/backend/agent/gateway";
import type { GatewayAction } from "@tabdo/backend/agent/gateway-contracts";
import type { RuntimeEnvironment } from "@tabdo/backend/agent/contracts";
import { ServiceError } from "@tabdo/backend/errors";
import { prepareProductExecution,executeProductTool } from "./agent-preparation.js";
import type { AcquireProductScope } from "./product-scope.js";

const actions = z.enum(["bootstrap","renew","cancelled","activity","tool","append","checkpoint","uninvoked","saveMessage","fail","release","settle"]);

/** Bounded JSON avoids buffering an unlimited private checkpoint into a Worker. */
export async function readGatewayJson(request: Request,maxBytes = 48 * 1024 * 1024): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400,{ message: "缺少执行请求内容" });
  const decoder = new TextDecoder();let size = 0,text = "";
  try {
    for (;;) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {});throw new ServiceError(413,{ message: "执行请求内容过大" }); }
      text += decoder.decode(value,{ stream: true });
    }
    text += decoder.decode();return JSON.parse(text) as unknown;
  } catch (error) { if (error instanceof ServiceError) throw error;throw new ServiceError(400,{ message: "执行请求格式无效" }); }
  finally { reader.releaseLock(); }
}

export function createProductGatewayHandler<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  runtimeEnvironment(env: Env): RuntimeEnvironment;
  afterSettled?(env: Env,executionId: string): Promise<void>;
}>) {
  return async (request: Request,env: Env,executionId: string,context?: Pick<ExecutionContext,"waitUntil">): Promise<Response> => {
    if (request.method !== "POST") return new Response(null,{ status: 405 });
    z.uuid().parse(executionId);
    const bearer = /^Bearer ([A-Za-z0-9._-]{64,256})$/i.exec(request.headers.get("authorization") ?? "");
    const launchToken = request.headers.get("x-tabdo-launch-token");
    if (!bearer || !launchToken || !z.uuid().safeParse(launchToken).success) throw new ServiceError(401,{ message: "执行能力无效" });
    const envelope = z.object({ action: actions,payload: z.unknown() }).parse(await readGatewayJson(request));
    const scope = await options.acquire(env);
    try {
      const result = await handleExecutionGateway(scope.runtime,{ executionId,launchToken,token: bearer[1] },envelope.action as GatewayAction,envelope.payload as never,{
        prepare: loaded => prepareProductExecution(scope,options.runtimeEnvironment(env),loaded),
        executeTool: input => executeProductTool(scope,input),
      });
      if(envelope.action === "settle" && context && options.afterSettled) context.waitUntil(options.afterSettled(env,executionId).catch(()=>console.warn("agent.cleanup.pending")));
      return Response.json(result);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // No stack, provider stdout or execution credentials cross the gateway.
      throw new ServiceError(503,{ message: "执行服务暂不可用" });
    } finally { await scope.close(); }
  };
}
