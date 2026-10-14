/** Persisted protocol shared by outbox, publisher and execution receipt. */
export type AutomationDelivery = Readonly<{ protocol: 1; eventId: string; generation: number }>;

const eventIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseAutomationDelivery(input: unknown): AutomationDelivery {
  if (typeof input !== "object" || input === null) throw new Error("Invalid automation delivery");
  if (!("protocol" in input) || input.protocol !== 1 || !("eventId" in input)
    || typeof input.eventId !== "string" || !eventIdPattern.test(input.eventId)
    || !("generation" in input) || typeof input.generation !== "number"
    || !Number.isSafeInteger(input.generation) || input.generation < 0) {
    throw new Error("Invalid automation delivery");
  }
  return Object.freeze({ protocol: 1, eventId: input.eventId, generation: input.generation });
}

/** Application identity, not a Cloudflare message ID or provider dedup guarantee. */
export function automationDeliveryId(delivery: AutomationDelivery): string {
  const checked = parseAutomationDelivery(delivery);
  return `automation-${checked.eventId}-${checked.generation}`;
}
