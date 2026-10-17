import assert from "node:assert/strict";
import { withNodeResources } from "../../src/resources/node.js";
import { createAutomationService } from "../../src/automation/jobs/service.js";
import { calendarTestOutbound } from "../fixtures/calendar-outbound.js";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("_queue_test"));
assert(new URL(process.env.DATABASE_URL!).pathname.includes(process.env.HERDR_TEAM_TEST_DATABASE!));
assert(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test-"));
assert.equal(process.env.QUEUE_PREFIX, process.env.HERDR_TEAM_REDIS_PREFIX);
await withNodeResources(async () => {
  const transport = calendarTestOutbound(Number(process.env.HERDR_TEAM_PORT));
  const service = createAutomationService({ recoveryIntervalMs: 1000, calendarOutbound: { ...transport, async send(input) {
    const result = await transport.send(input);
    if (input.headers["X-Tabdo-Delivery-Id"] === process.env.FAULT_DELIVERY_ID) process.kill(process.pid, "SIGKILL");
    return result;
  } } });
  await service.ready; console.log("SUBSCRIPTION_WORKER_READY");
  process.on("SIGTERM", () => void service.close().then(() => process.exit(0)));
});
