import { dispatchKeyCommand } from "../data-api/commands.js";
import { siteQueryCalendarView } from "../data-api/calendar-views.js";
import { BlogError } from "../blogs/errors.js";
import { updateScheduledAutomation } from "../calendar/schedules.js";
import { CALENDAR_READ_COMMANDS } from "@tabdo/shared";
import { DocumentError } from "../documents/errors.js";
import { executeCalendar } from "../calendar/service.js";
import { CalendarError } from "../calendar/errors.js";
import { isCalendarCommand, calendarTransportInput } from "../calendar/transport.js";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import type { RequestScope, RequestScopeResolver } from "./request.js";
import { ServiceError } from "../errors.js";
import * as keys from "../data-api/keys.js";
import * as data from "../data-api/data.js";

/** Both REST and the command transport use exactly the GraphQL capability services. */
export function createDataRestRoutes(acquire: RequestScopeResolver, options: { publicOrigin?: string; clientIp?: (context: Context) => string } = {}) {
  const route = new Hono();
  route.use("*", async (c, next) => {
    const headers = c.req.header("Access-Control-Request-Headers") ?? "";
    if (keys.requestApiKey(c.req.raw) || c.req.method === "OPTIONS" && /authorization|x-tabdo-key/i.test(headers))
      return cors({ origin: "*", credentials: false, allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization", "X-Tabdo-Key", "Idempotency-Key"] })(c, next);
    return next();
  });
  route.use("*", (c, next) => keys.requestApiKey(c.req.raw) ? bodyLimit({ maxSize: 8 * 1024 * 1024 })(c, next) : next());
  type Input = { scope: RequestScope; context: data.SiteContext; c: Context; body: Record<string, unknown> };
  const handle = (write: boolean, fn: (input: Input) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context, next: Next) => {
    const secret = keys.requestApiKey(c.req.raw); if (!secret) return next();
    let scope: RequestScope | undefined;
    try {
      if (Number(c.req.header("Content-Length")) > 8 * 1024 * 1024) throw new ServiceError(413, { message: "Request body too large" });
      const raw = ["GET", "DELETE"].includes(c.req.method) ? "" : await c.req.text();
      if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024) throw new ServiceError(413, { message: "Request body too large" });
      let body: Record<string, unknown> = {};
      try { body = raw ? z.record(z.string(), z.unknown()).parse(JSON.parse(raw)) : {}; }
      catch { throw new ServiceError(400, { message: "Invalid request data" }); }
      const idempotencyHeader = c.req.header("Idempotency-Key");
      if (idempotencyHeader && body.idempotencyKey !== undefined && body.idempotencyKey !== idempotencyHeader) throw new ServiceError(400, { message: "Idempotency-Key must match the input" });
      const imageUpload = c.req.method === "POST" && (body.command === "uploadRowAttachment" && c.req.path.endsWith("/commands") || /\/attachments$/.test(c.req.path));
      if (new TextEncoder().encode(raw).byteLength > 128 * 1024 && !imageUpload) throw new ServiceError(413, { message: "Request body too large" });
      scope = await acquire(c.req.raw);
      const principal = await keys.resolveSiteKey(scope.commands.database, secret);
      if (!scope.siteRateLimit) throw new ServiceError(503, { message: "API rate limiting is unavailable" });
      await scope.siteRateLimit({ keyId: principal.id, ip: options.clientIp?.(c) ?? "unknown", kind: write ? "create" : "read" });
      const context = { principal, secret, baseUrl: options.publicOrigin ?? new URL(c.req.url).origin };
      c.header("Cache-Control", "private, no-store");
      return c.json(await fn({ scope, context, c, body }), status);
    } catch (error) {
      if (error instanceof ServiceError) return c.json({ error: error.message, ...(error instanceof BlogError || error instanceof CalendarError || error instanceof DocumentError ? { code: error.code } : {}) }, error.status as 400);
      if (error instanceof z.ZodError) return c.json({ error: "Invalid request data" }, 400);
      return c.json({ error: "Request could not be completed" }, 500);
    } finally { try { await scope?.close(); } catch { /* Committed responses survive cleanup failures. */ } }
  };
  route.post("/views/:id/calendar/query", handle(false, ({ scope, context, c, body }) => siteQueryCalendarView(scope.commands, context, { ...body, viewId: c.req.param("id") })));
  route.get("/tables", handle(false, ({ scope, context }) => data.siteTables(scope.commands, context)));
  route.get("/tables/:id", handle(false, ({ scope, context, c }) => data.siteTable(scope.commands, context, c.req.param("id")!)));
  route.get("/tables/:id/rows", handle(false, ({ scope, context, c }) => data.siteRows(scope.commands, context, c.req.param("id")!, {
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined, cursor: c.req.query("cursor"), includeTotal: c.req.query("includeTotal") === "true" || c.req.query("includeTotal") === "1",
  })));
  route.post("/tables/:id/rows/query", handle(false, ({ scope, context, c, body }) => data.siteRows(scope.commands, context, c.req.param("id")!, body)));
  route.post("/tables/:id/rows", handle(true, ({ scope, context, c, body }) => data.siteCreateRow(scope.commands, context, c.req.param("id")!, body.cells, { body: body.body as never, idempotencyKey: (body.idempotencyKey ?? c.req.header("Idempotency-Key")) as string }), 201));
  route.get("/tables/:id/rows/:rowId", handle(false, ({ scope, context, c }) => data.siteRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!, { includeBody: c.req.query("include") === "body", bodyFormat: c.req.query("bodyFormat") as "json" | "html" })));
  route.patch("/tables/:id/rows/:rowId", handle(true, ({ scope, context, c, body }) => data.siteUpdateRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!, body.cells, body.expectedVersion as number | undefined, { body: body.body as never, idempotencyKey: (body.idempotencyKey ?? c.req.header("Idempotency-Key")) as string })));
  route.delete("/tables/:id/rows/:rowId", handle(true, ({ scope, context, c }) => data.siteDeleteRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!)));
  route.post("/commands", handle(true, async input => {
    return dispatchKeyCommand(input.scope.commands, input.context, input.body, input.c.req.header("Idempotency-Key"));
  }));
  const calendar = (command: import("@tabdo/shared").CalendarCommand, argumentsFor: (input: Input) => Record<string, unknown>) => handle(!CALENDAR_READ_COMMANDS.includes(command), input => executeCalendar(input.scope.commands, { kind: "key", secret: input.context.secret }, command, calendarTransportInput(command, argumentsFor(input), input.c.req.header("Idempotency-Key"))));
  route.post("/schedules/occurrences/query", calendar("queryScheduledOccurrences", ({ body }) => body));
  route.patch("/automations/:id", handle(true, ({ scope, context, c, body }) => updateScheduledAutomation(scope.commands, context.secret, { ...body, automationId: c.req.param("id") })));
  route.get("/calendars/:id/bookings/:bookingId/reminders", calendar("listBookingReminders", ({ c }) => ({ calendarId: c.req.param("id"), bookingId: c.req.param("bookingId") })));
  route.post("/calendars/:id/bookings/:bookingId/reminders", calendar("setBookingReminders", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), bookingId: c.req.param("bookingId") })));
  route.post("/calendars/:id/subscriptions/query", calendar("listCalendarSubscriptions", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.post("/calendars/:id/subscriptions", calendar("createCalendarSubscription", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.get("/calendars/:id/subscriptions/:subscriptionId", calendar("getCalendarSubscription", ({ c }) => ({ calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId") })));
  route.patch("/calendars/:id/subscriptions/:subscriptionId", calendar("updateCalendarSubscription", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId") })));
  route.post("/calendars/:id/subscriptions/:subscriptionId/revoke", calendar("revokeCalendarSubscription", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId") })));
  route.post("/calendars/:id/subscriptions/:subscriptionId/rotate-secret", calendar("rotateCalendarSubscriptionSecret", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId") })));
  route.post("/calendars/:id/subscriptions/:subscriptionId/deliveries/query", calendar("listCalendarDeliveries", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId") })));
  route.get("/calendars/:id/subscriptions/:subscriptionId/deliveries/:deliveryId", calendar("getCalendarDelivery", ({ c }) => ({ calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId"), deliveryId: c.req.param("deliveryId") })));
  route.post("/calendars/:id/subscriptions/:subscriptionId/deliveries/:deliveryId/retry", calendar("retryCalendarDelivery", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), subscriptionId: c.req.param("subscriptionId"), deliveryId: c.req.param("deliveryId") })));
  route.get("/calendars", calendar("listCalendars", ({ c }) => ({ includeArchived: c.req.query("includeArchived") === "true" })));
  route.post("/calendars", calendar("createCalendar", ({ body }) => body));
  route.get("/calendars/:id", calendar("getCalendar", ({ c }) => ({ calendarId: c.req.param("id") })));
  route.patch("/calendars/:id", calendar("updateCalendar", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.post("/calendars/:id/archive", calendar("archiveCalendar", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.get("/calendars/:id/people", calendar("listCalendarPeople", ({ c }) => ({ calendarId: c.req.param("id"), includeArchived: c.req.query("includeArchived") === "true" })));
  route.post("/calendars/:id/people", calendar("createCalendarPerson", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.get("/calendars/:id/people/:personId", calendar("getCalendarPerson", ({ c }) => ({ calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.patch("/calendars/:id/people/:personId", calendar("updateCalendarPerson", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.post("/calendars/:id/people/:personId/archive", calendar("archiveCalendarPerson", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.get("/calendars/:id/people/:personId/hours", calendar("getWorkingHours", ({ c }) => ({ calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.post("/calendars/:id/people/:personId/hours", calendar("setWorkingHours", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.post("/calendars/:id/people/:personId/exceptions/query", calendar("listAvailabilityExceptions", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.post("/calendars/:id/people/:personId/exceptions", calendar("setAvailabilityException", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId") })));
  route.post("/calendars/:id/people/:personId/exceptions/:exceptionId/remove", calendar("removeAvailabilityException", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), personId: c.req.param("personId"), exceptionId: c.req.param("exceptionId") })));
  route.post("/calendars/:id/bookings/query", calendar("queryBookings", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.get("/calendars/:id/bookings/:bookingId", calendar("getBooking", ({ c }) => ({ calendarId: c.req.param("id"), bookingId: c.req.param("bookingId") })));
  route.post("/calendars/:id/bookings", calendar("createBooking", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.post("/calendars/:id/bookings/:bookingId/reschedule", calendar("rescheduleBooking", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), bookingId: c.req.param("bookingId") })));
  route.post("/calendars/:id/bookings/:bookingId/cancel", calendar("cancelBooking", ({ c, body }) => ({ ...body, calendarId: c.req.param("id"), bookingId: c.req.param("bookingId") })));
  route.post("/calendars/:id/availability/query", calendar("queryAvailability", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.post("/calendars/:id/conflicts/check", calendar("checkBookingConflicts", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  route.post("/calendars/:id/bookings/batch", calendar("batchBookings", ({ c, body }) => ({ ...body, calendarId: c.req.param("id") })));
  const attachment = (command: "uploadRowAttachment" | "getRowAttachment") => handle(command === "uploadRowAttachment", async input => {
    const result = await dispatchKeyCommand(input.scope.commands, input.context, { command, input: { ...input.body, tableId: input.c.req.param("tableId"), rowId: input.c.req.param("rowId"), target: input.body.target ?? "body", ...(command === "getRowAttachment" ? { fileId: input.c.req.param("fileId") } : {}) } }, input.c.req.header("Idempotency-Key"));
    return result.result;
  });
  route.post("/tables/:tableId/rows/:rowId/attachments", attachment("uploadRowAttachment"));
  route.get("/tables/:tableId/rows/:rowId/attachments/:fileId", attachment("getRowAttachment"));
  route.all("/tables/:tableId/rows/:rowId/document/*", c => c.json({ error: "Retired API; use row body and attachments" }, 410));
  route.all("/tables/:tableId/rows/:rowId/document", c => c.json({ error: "Retired API; use row body and attachments" }, 410));
  return route;
}
