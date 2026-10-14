import { z } from "zod";
import { parseAutomationDelivery,type AutomationDelivery } from "@tabdo/shared";
import type { QueueMessage } from "@tabdo/core/queue";
import { consumeQueueBatch } from "@tabdo/platform-cloudflare/queue";
import { loadNativeExecution } from "@tabdo/backend/agent/executions";
import { ServiceError } from "@tabdo/backend/errors";
import type { AcquireProductScope } from "./product-scope.js";

const agentJob = z.object({ protocol: z.literal(1),kind: z.literal("agent-execution"),executionId: z.uuid() }).strict();
export type AgentExecutionJob = z.infer<typeof agentJob>;
export type ProductJob = AgentExecutionJob | AutomationDelivery;
export function executionJob(executionId: string): QueueMessage<AgentExecutionJob> {
  return { id: `agent-execution:${executionId}`,body: agentJob.parse({ protocol: 1,kind: "agent-execution",executionId }) };
}

/** Acknowledges existing durable work / finite dispatch, never a full native Harness turn. */
export function createProductQueueHandler<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  startExecution(env: Env,executionId: string): Promise<void>;
  acceptAutomation?(env: Env,delivery: AutomationDelivery,attempt: number): Promise<void>;
}>) {
  return (batch: MessageBatch<unknown>,env: Env) => consumeQueueBatch(batch,async (message,attempt) => {
    const parsed = agentJob.safeParse(message.body);
    if (parsed.success) {
      const scope = await options.acquire(env);
      let accepted = false;
      try {
        // Identity and ownership derive from the private PG receipt, never the job body.
        const loaded = await loadNativeExecution(scope.runtime,parsed.data.executionId);
        accepted = loaded.execution.status === "accepted" && ["starting","running"].includes(loaded.run.status);
      } finally { await scope.close(); }
      if (accepted) await options.startExecution(env,parsed.data.executionId);
      return;
    }
    const delivery = parseAutomationDelivery(message.body);
    if (!options.acceptAutomation) throw new ServiceError(503,{ message: "自动化执行服务未配置" });
    await options.acceptAutomation(env,delivery,attempt);
  },(_error,messageId) => console.warn("queue.dispatch.retry",messageId));
}
