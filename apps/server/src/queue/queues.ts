import { createBullMQQueue, closeBullMQQueue, createBullMQPublisher } from "@tabdo/queue/adapters/bullmq";
import { automationDeliveryId, type AutomationDelivery } from "@tabdo/shared";
import { queueName, prefix, redisOptions, attempts } from "./config.js";
export type AutomationJob = AutomationDelivery;
const config = () => ({ connection: redisOptions(false), queueName, jobName: "execute", prefix, attempts });
export function createQueue() { return createBullMQQueue<AutomationJob>(config()); }
export function createPublisher() { return createBullMQPublisher<AutomationJob>(config()); }
export const jobId = (eventId: string, generation = 0) => automationDeliveryId({ protocol: 1, eventId, generation });
export const closeQueue = closeBullMQQueue;
