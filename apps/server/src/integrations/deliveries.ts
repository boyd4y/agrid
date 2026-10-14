import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDatabase } from "../resources/scope.js";

import { integrationConnections, integrationDeliveries, webhookEndpoints } from "../db/schema.js";
import { appendExternalAutomationEvent, type ExternalAutomationEvent } from "../automation/events.js";

type Endpoint = typeof webhookEndpoints.$inferSelect;
export async function persistDelivery(endpoint: Endpoint, input: {
  dedupeKey: string; logicalKey?: string; payload: Record<string, unknown>; event?: Omit<ExternalAutomationEvent, "id" | "organizationId" | "traceId">;
}) {
  return getDatabase().transaction(async tx => {
    // Match the management lock order, and recheck revocation before accepting.
    if (endpoint.connectionId) {
      const [connection] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, endpoint.connectionId)).for("share");
      if (!connection || connection.deletedAt || !connection.enabled || connection.organizationId !== endpoint.organizationId) throw new HTTPException(410, { message: "此连接已停用" });
    }
    const [current] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.organizationId, endpoint.organizationId), isNull(webhookEndpoints.deletedAt))).for("share");
    if (!current || !current.enabled) throw new HTTPException(410, { message: "此 Webhook 已停用" });
    if (current.state !== "active" || JSON.stringify(current.encryptedSigningSecret) !== JSON.stringify(endpoint.encryptedSigningSecret) || current.tokenHash !== endpoint.tokenHash) throw new HTTPException(409, { message: "Webhook 配置已变化，请重试" });
    const [delivery] = await tx.insert(integrationDeliveries).values({ endpointId: endpoint.id, organizationId: endpoint.organizationId, connectionId: endpoint.connectionId,
      dedupeKey: input.dedupeKey, logicalKey: input.logicalKey, payload: input.payload, status: "received" }).onConflictDoNothing().returning();
    if (!delivery) return { duplicate: true };
    const id = randomUUID();
    const eventId = input.event ? await appendExternalAutomationEvent(tx, { ...input.event, id, organizationId: endpoint.organizationId, traceId: id }) : null;
    await tx.update(integrationDeliveries).set({ eventId, status: eventId ? "received" : "ignored" }).where(eq(integrationDeliveries.id, delivery.id));
    return { duplicate: false };
  });
}
