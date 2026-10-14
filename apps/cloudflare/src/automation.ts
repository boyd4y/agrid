import { eq } from "drizzle-orm";
import type { AutomationDelivery } from "@tabdo/shared";
import { automationEvents } from "@tabdo/backend/schema";
import type { NativeExecutionReference } from "@tabdo/backend/agent/executions";
import { resolveChatAgentConfiguration } from "@tabdo/backend/agent/admission";
import type { RuntimeEnvironment } from "@tabdo/backend/agent/contracts";
import { runAutomationAgentAction } from "@tabdo/backend/automation/agent-action";
import { claimExecution,executeNext,recordFailure,reconcileNativeAutomations,PermanentError,FenceLostError,type AutomationExecutionDependencies } from "@tabdo/backend/automation/execution";
import type { ExternalAutomationEvent } from "@tabdo/backend/automation/events";
import { prepareProductAgent } from "./agent-preparation.js";
import type { AcquireProductScope,ProductScope } from "./product-scope.js";

export function createProductAutomationServices<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  dispatch(env: Env,reference: NativeExecutionReference): Promise<void>;
  requeue(env: Env,delivery: AutomationDelivery): Promise<void>;
  runtimeEnvironment(env: Env): RuntimeEnvironment;
  hydrate?(env: Env,event: ExternalAutomationEvent): Promise<ExternalAutomationEvent>;
  maxAttempts?: number;
}>) {
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new TypeError("Invalid automation attempt limit");
  function dependencies(env: Env,scope: ProductScope): AutomationExecutionDependencies {
    return {
      ...scope.commands,
      hydrateAgentMailEvent: options.hydrate ? event => options.hydrate!(env,event) : undefined,
      runAgentAction: input => runAutomationAgentAction({ ...scope.runtime,agent: {
        async prepare(input) {
          const configuration = await resolveChatAgentConfiguration(scope.runtime,input);
          await prepareProductAgent(scope,options.runtimeEnvironment(env),configuration,input.context);
          return configuration;
        },
        dispatch: reference => options.dispatch(env,reference),
      } },input),
    };
  }
  return {
    async accept(env: Env,delivery: AutomationDelivery,attempt: number): Promise<void> {
      const scope = await options.acquire(env),deps = dependencies(env,scope);
      let fence: number | undefined;
      try {
        const [event] = await scope.runtime.database.select().from(automationEvents).where(eq(automationEvents.id,delivery.eventId));
        if (!event || event.finishedAt || event.generation !== delivery.generation) return;
        fence = await claimExecution(deps,delivery.eventId,delivery.generation);
        if (fence === undefined) return;
        // Each data mutation and step receipt share one fenced PG transaction.
        // Native actions only commit a durable handoff; no provider turn is awaited.
        for (let step = 0;step < 25;step++) if (await executeNext(deps,delivery.eventId,fence) === "done") return;
        await options.requeue(env,delivery);
      } catch (error) {
        if (error instanceof FenceLostError) return;
        const failure = error instanceof Error ? error : new Error("自动化执行失败");
        const final = error instanceof PermanentError || attempt >= maxAttempts;
        await recordFailure(deps,delivery.eventId,failure,final,fence,delivery.generation);
        if (!final) throw error;
      } finally { await scope.close(); }
    },
    async reconcile(env: Env): Promise<number> {
      const scope = await options.acquire(env);
      try { return await reconcileNativeAutomations(dependencies(env,scope)); }
      finally { await scope.close(); }
    },
  };
}
