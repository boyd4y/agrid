import { consumeQueueBatch } from "@tabdo/queue/adapters/cloudflare";
import type { TriggerServices } from "./contracts.js";

/** Deployment entry injects shared platform services with event-scoped DB resources. */
export function createCloudflareTriggers<Env>(services: (env: Env) => TriggerServices) {
  return {
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
      const platform = services(env);
      await consumeQueueBatch(batch, (message, attempt) => platform.accept(message, attempt));
    },
    async scheduled(controller: ScheduledController, env: Env): Promise<void> {
      await services(env).wakeSchedules({ scheduledTime: controller.scheduledTime, cron: controller.cron });
    },
  };
}
