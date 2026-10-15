import { createBullMQQueue, closeBullMQQueue, createBullMQPublisher } from "@tabdo/queue/bullmq";
import { automationDeliveryId, type AutomationDelivery } from "@tabdo/shared";
import { queueName, prefix, redisOptions, attempts } from "./config.js";
export type AutomationJob = AutomationDelivery;
export const queueConfig = () => ({ connection: redisOptions(false), queueName, jobName: "execute", prefix, attempts });
export function createQueue(): ReturnType<typeof createBullMQQueue<AutomationJob>> { return createBullMQQueue<AutomationJob>(queueConfig()); }
export function createPublisher() { return createBullMQPublisher<AutomationJob>(queueConfig()); }
export const jobId = (eventId: string, generation = 0) => automationDeliveryId({ protocol: 1, eventId, generation });
export const closeQueue = closeBullMQQueue;
