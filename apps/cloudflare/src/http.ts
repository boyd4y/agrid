import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ServiceError } from "@tabdo/backend/errors";
import { createCommandsRoute } from "@tabdo/backend/http/commands";
import { createTablesRoute } from "@tabdo/backend/http/tables";
import { createRowsRoute } from "@tabdo/backend/http/rows";
import { createColumnsRoute } from "@tabdo/backend/http/columns";
import { createThreadsRoute } from "@tabdo/backend/http/threads";
import { createMembersRoute } from "@tabdo/backend/http/members";
import { createApiKeysRoute } from "@tabdo/backend/http/api-keys";
import { createReportsRoute } from "@tabdo/backend/http/reports";
import { createSkillsRoute } from "@tabdo/backend/http/skills";
import { createAutomationsRoute } from "@tabdo/backend/http/automations";
import { createFilesRoute } from "@tabdo/backend/http/files";
import { createIntegrationsRoute } from "@tabdo/backend/http/integrations";
import { createWebhookEndpointsRoute,createWebhooksRoute } from "@tabdo/backend/http/webhooks";
import { acquire,chat,subscribe,cancelRun,cleanupCompute,relayOutbox,notifyOutput } from "./composition.js";
import { createProductGatewayHandler } from "./gateway.js";
import { runtimeEnvironment,type ProductEnvironment } from "./configuration.js";
import { parseExecutionReference } from "./contracts.js";

export function createHttpApplication(env: ProductEnvironment) {
  const app = new Hono();
  const requestScope = (_request:Request)=>acquire(env);
  app.use("*",cors({origin:env.APP_URL,allowMethods:["GET","POST","PATCH","DELETE","OPTIONS","PUT"],allowHeaders:["Content-Type","Authorization","Last-Event-ID"],credentials:true}));
  app.use("/api/*",async(c,next)=>{
    await next();
    if (["POST","PATCH","PUT","DELETE"].includes(c.req.method) && c.res.ok) {
      c.executionCtx.waitUntil(relayOutbox(env).catch(()=>console.warn("queue.outbox.wake-pending")));
    }
  });
  app.onError((error,c)=>{
    if(error instanceof ServiceError) return c.json({error:error.message},error.status as ContentfulStatusCode);
    if(error.name==="ZodError") return c.json({error:"参数错误"},400);
    console.error("http.request",error.name);
    return c.json({error:"服务暂不可用"},503);
  });
  app.get("/api/health",c=>c.json({ok:true,service:"tabdo",auth:true,multiHarness:true,automations:true}));
  app.on(["GET","POST"],"/api/auth/*",async c=>{const scope=await acquire(env);try{return await scope.auth.handler(c.req.raw);}finally{await scope.close();}});
  app.get("/api/chat/status",c=>chat.status(c.req.raw,env));
  app.post("/api/chat",c=>chat.post(c.req.raw,env,c.executionCtx));
  app.get("/api/agent-executions/:id/stream",c=>subscribe(env,c.req.raw,parseExecutionReference({executionId:c.req.param("id"),runId:c.req.query("runId"),threadId:c.req.query("threadId")})));
  app.post("/api/threads/:id/runs/:runId/cancel",async c=>c.json(await cancelRun(env,c.req.raw,c.req.param("id"),c.req.param("runId"))));
  const gateway = createProductGatewayHandler({acquire,runtimeEnvironment,afterChanged:notifyOutput,afterSettled:cleanupCompute});
  app.post("/internal/agent-executions/:id/gateway",c=>gateway(c.req.raw,env,c.req.param("id"),c.executionCtx));
  app.route("/api/commands",createCommandsRoute(requestScope));
  app.route("/api/tables",createTablesRoute(requestScope));
  app.route("/api",createRowsRoute(requestScope));
  app.route("/api",createColumnsRoute(requestScope));
  app.route("/api/threads",createThreadsRoute(requestScope));
  app.route("/api/members",createMembersRoute(requestScope));
  app.route("/api/user/api-keys",createApiKeysRoute(requestScope));
  app.route("/api/reports",createReportsRoute(requestScope));
  app.route("/api/skills",createSkillsRoute(requestScope));
  app.route("/api",createAutomationsRoute(requestScope));
  app.route("/api",createFilesRoute(requestScope));
  app.route("/api/integrations",createIntegrationsRoute(requestScope));
  app.route("/api/webhook-endpoints",createWebhookEndpointsRoute(requestScope));
  app.route("/api/webhooks",createWebhooksRoute(requestScope));
  return app;
}
