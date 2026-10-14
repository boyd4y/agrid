import { createAutomationQueue, closeAutomationQueue, createAutomationPublisher } from "@tabdo/runtime-node/queue";
import { automationDeliveryId, type AutomationDelivery } from "@tabdo/core";
import { queueName, prefix, redisOptions, attempts } from "./config.js";
export type AutomationJob = AutomationDelivery;
const config = () => ({ connection: redisOptions(false), queueName, prefix, attempts });
export function createQueue() { return createAutomationQueue(config()); }
export function createPublisher() { return createAutomationPublisher(config()); }
export const jobId = (eventId: string, generation = 0) => automationDeliveryId({ protocol: 1, eventId, generation });
export const closeQueue = closeAutomationQueue;
