import { z } from "zod";
import { loadNativeExecution } from "@tabdo/backend/agent/executions";
import { issueExecutionGateway } from "@tabdo/backend/agent/gateway";
import { createContainerExecutionObject,type ContainerExecutionProgram } from "@tabdo/platform-cloudflare/execution/container-object";
import type { AcquireProductScope } from "./product-scope.js";

/** Trusted application composition; the provider adapter remains unaware of platform Runs. */
export function createProductExecutionObject<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  program(env: Env): ContainerExecutionProgram;
  gatewayOrigin(env: Env): string;
}>) {
  return createContainerExecutionObject<Env>(options.program,{
    async verifyAccepted(env,request) {
      const reference = z.object({ executionId: z.uuid() }).strict().parse(request.reference);
      if (reference.executionId !== request.id) throw new Error("Execution reference mismatch");
      const scope = await options.acquire(env);
      try { await loadNativeExecution(scope.runtime,request.id); }
      finally { await scope.close(); }
    },
    async prepare(env,request,launchToken) {
      const scope = await options.acquire(env);
      try {
        const credentials = await issueExecutionGateway(scope.runtime,request.id,{ launchToken });
        const gatewayUrl = new URL(`/internal/agent-executions/${request.id}/gateway`,options.gatewayOrigin(env)).toString();
        // Only scoped capability and gateway location enter finite execution stdin.
        // Database, Redis, Better Auth and administrative secrets are never copied.
        return { stdin: JSON.stringify({ executionId: credentials.executionId,launchToken: credentials.launchToken,token: credentials.token,gatewayUrl }) };
      } finally { await scope.close(); }
    },
  });
}
