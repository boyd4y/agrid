import assert from "node:assert/strict";
import { test } from "node:test";
import { automationDeliveryId, parseAutomationDelivery } from "../src/automation-delivery.js";

test("stable application delivery identity distinguishes intentional replay generations", () => {
  const eventId = "e39e1b5e-ae42-4c50-9179-3597fe83fef1";
  const delivery = parseAutomationDelivery({ protocol: 1, eventId, generation: 0, userId: "untrusted" });
  assert(Object.isFrozen(delivery));
  assert.deepEqual(delivery, { protocol: 1, eventId, generation: 0 });
  assert.equal(automationDeliveryId(delivery), `automation-${eventId}-0`);
  assert.notEqual(automationDeliveryId(delivery), automationDeliveryId({ ...delivery, generation: 1 }));
  for (const input of [null, {}, { ...delivery, protocol: 3 }, { ...delivery, eventId: "user-supplied" },
    { ...delivery, generation: -1 }, { ...delivery, generation: 0.1 }, { ...delivery, generation: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => parseAutomationDelivery(input), /Invalid automation delivery/);
  }
});

test("calendar delivery version is preserved; the old delivery protocol remains unchanged", () => {
  const eventId = "00000000-0000-0000-0000-000000000045";
  assert.deepEqual(parseAutomationDelivery({ protocol: 2, eventId, generation: 1 }), { protocol: 2, eventId, generation: 1 });
});
