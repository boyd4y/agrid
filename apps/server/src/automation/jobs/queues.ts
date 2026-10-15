import { createBullMQTransport } from "@tabdo/queue/bullmq";
import { automationDeliveryId, type AutomationDelivery } from "@tabdo/shared";
import { queueName, prefix, redisOptions, attempts } from "./config.js";
import type { BackgroundWakeup } from "../../business/background.js";
export type AutomationWakeup = BackgroundWakeup | Readonly<{ kind: "native-actions" }>;
export type AutomationJob = AutomationDelivery;
export function createAutomationQueue(overrides: { attempts?: number; retryDelayMs?: number } = {}) {
  return createBullMQTransport<AutomationJob>({
    connection: redisOptions(false), workerConnection: redisOptions(true),
    queueName, jobName: "execute", prefix, attempts, ...overrides,
  });
}
export const jobId = (eventId: string, generation = 0) => automationDeliveryId({ protocol: 1, eventId, generation });
export function createAutomationControlQueue() {
  return createBullMQTransport<AutomationWakeup>({
    connection: redisOptions(false), workerConnection: redisOptions(true),
    queueName: `${queueName}-control`, jobName: "wake", prefix, attempts,
  });
}
