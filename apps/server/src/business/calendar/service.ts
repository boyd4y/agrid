import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { sha256 } from "@tabdo/core/crypto";
import { CALENDAR_SCHEMAS, CALENDAR_READ_COMMANDS, type CalendarCommand, type CalendarCommands, type CalendarResults, type CalendarPermission } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { calendars, calendarPeople, availabilityExceptions, bookings, calendarReceipts, member, user, rows, tables } from "../db/schema.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { resolveSiteKey, type SitePrincipal } from "../data-api/keys.js";
import { CalendarError, calendarDatabaseError } from "./errors.js";
import { openIntervals, overlaps, parseBookingTime, subtractBusy, type Interval } from "./time.js";

type Identity = { organizationId?: string; actorId?: string };
export type CalendarCaller = { kind: "member"; organizationId: string; actorId: string } | { kind: "key"; secret: string };
type Person = typeof calendarPeople.$inferSelect;
type StoredBooking = typeof bookings.$inferSelect;
function fail(status: number, code: ConstructorParameters<typeof CalendarError>[1], message: string): never { throw new CalendarError(status, code, message); }
function page<T>(items: T[], limit = 500) { if (items.length > limit) fail(400, "QUERY_LIMIT", `Query exceeds ${limit} items; use a smaller range`); return { items, complete: true as const, limit }; }
function cas(actual: number, expected: number | undefined) { if (actual !== expected) fail(409, "VERSION_CONFLICT", "The record changed; refresh and try again"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",") + "}";
  return JSON.stringify(value);
}
const receipt = (booking: StoredBooking) => ({ id: booking.id, version: booking.version, revision: booking.revision, status: booking.status });
const publicCalendar = ({ organizationId: _, ...calendar }: typeof calendars.$inferSelect) => calendar;
const publicPerson = ({ workspaceId: _, ...person }: Person) => person;

/** The single core for UI, keys, REST, GraphQL, SDK, MCP and native host tools. */
export async function executeCalendar<K extends CalendarCommand>(deps: CommandDependencies, caller: CalendarCaller, command: K, raw: unknown, transaction?: Transaction): Promise<CalendarResults[K]> {
  const parsed = CALENDAR_SCHEMAS[command].safeParse(raw);
  if (!parsed.success) fail(400, "BAD_INPUT", parsed.error.issues[0]?.message ?? "Invalid calendar input");
  // The command switch narrows each schema below. No transport supplies trusted scope.
  const input = parsed.data as Record<string, any>;
  const read = CALENDAR_READ_COMMANDS.includes(command);
  const result = await inTransaction(deps, transaction, async tx => {
    let principal: SitePrincipal | undefined, organizationId: string, principalId: string, manager = false;
    if (caller.kind === "key") {
      principal = await resolveSiteKey(tx, caller.secret, true);
      organizationId = principal.organizationId; principalId = `key:${principal.id}`;
    } else {
      organizationId = caller.organizationId; principalId = `user:${caller.actorId}`;
      const [current] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, caller.actorId))).for("share");
      if (!current) fail(403, "FORBIDDEN", "Current membership is required");
      manager = ["owner", "admin"].includes(current.role);
    }
    let calendar: typeof calendars.$inferSelect | undefined;
    let workspaceId: string;
    if (input.calendarId) {
      const query = tx.select().from(calendars).where(and(eq(calendars.id, input.calendarId), eq(calendars.organizationId, organizationId)));
      [calendar] = await (read ? query.for("share") : query.for("update"));
      if (!calendar) fail(404, "NOT_FOUND", "Calendar not found");
      workspaceId = calendar.workspaceId;
      if (!principal) {
        const workspace = await requireWorkspace(deps, organizationId, tx);
        if (workspace.id !== workspaceId) fail(404, "NOT_FOUND", "Calendar not found");
      }
    } else if (principal && command === "listCalendars") {
      // Each returned calendar is an explicitly granted target; no workspace busy data is joined.
      return page((await tx.select().from(calendars).where(and(eq(calendars.organizationId, organizationId), inArray(calendars.id, [...principal.calendarPermissions.keys()]), input.includeArchived ? undefined : eq(calendars.archived, false))).orderBy(asc(calendars.id)).limit(501)).map(publicCalendar));
    } else {
      if (principal) fail(403, "FORBIDDEN", "API keys cannot create unscoped calendars");
      workspaceId = (await requireWorkspace(deps, organizationId, tx)).id;
    }
    const authorize = (permission: keyof Omit<CalendarPermission, "calendarId">) => {
      if (principal) {
        if (!calendar || !principal.calendarPermissions.has(calendar.id)) fail(404, "NOT_FOUND", "Calendar not found");
        if (!principal.calendarPermissions.get(calendar!.id)![permission]) fail(403, "FORBIDDEN", "This calendar operation is not granted");
      } else if (permission === "canManage" && !manager) fail(403, "FORBIDDEN", "Only owners and admins can manage calendars and working hours");
    };
    const permissions: Partial<Record<CalendarCommand, keyof Omit<CalendarPermission, "calendarId">>> = {
      createBooking: "canCreate", rescheduleBooking: "canUpdate", cancelBooking: "canCancel",
      queryAvailability: "canReadAvailability", checkBookingConflicts: "canReadAvailability",
    };
    const permission = permissions[command] ?? (read ? "canRead" : "canManage");
    const configurationRead = ["listCalendarPeople", "getCalendarPerson", "getWorkingHours", "listAvailabilityExceptions"].includes(command);
    if (configurationRead && principal) {
      const grant = principal.calendarPermissions.get(calendar!.id);
      if (!grant) fail(404, "NOT_FOUND", "Calendar not found");
      if (!grant.canRead && !grant.canReadAvailability && !grant.canManage) fail(403, "FORBIDDEN", "Reading service configuration is not granted");
    } else if (command !== "listCalendars" && command !== "batchBookings") authorize(permission);
    const serializePerson = (person: Person) => ({ ...publicPerson(person), userId: principal && !principal.calendarPermissions.get(calendar!.id)?.canRead && !principal.calendarPermissions.get(calendar!.id)?.canManage ? null : person.userId });
    if (command === "batchBookings") for (const operation of input.operations) authorize(operation.kind === "create" ? "canCreate" : operation.kind === "reschedule" ? "canUpdate" : "canCancel");

    // Unique INSERT reserves absent keys, waits for concurrent requests and rolls back on failure.
    // Every replay rechecks current membership/grants before it can return a receipt.
    let requestId: string | undefined;
    if (!read) {
      const requestHash = await sha256(canonical(input));
      const [reserved] = await tx.insert(calendarReceipts).values({ workspaceId, principalId, command, key: input.idempotencyKey, requestHash }).onConflictDoNothing().returning({ id: calendarReceipts.id });
      if (!reserved) {
        const [existing] = await tx.select().from(calendarReceipts).where(and(eq(calendarReceipts.workspaceId, workspaceId), eq(calendarReceipts.principalId, principalId), eq(calendarReceipts.command, command), eq(calendarReceipts.key, input.idempotencyKey)));
        if (existing.requestHash !== requestHash) fail(409, "IDEMPOTENCY_MISMATCH", "The idempotency key was already used for different input");
        return existing.result;
      }
      requestId = reserved.id;
    }
    if (calendar?.archived && !read) fail(409, "ARCHIVED", "The calendar is archived");
    const peopleScope = and(eq(calendarPeople.workspaceId, workspaceId));
    const loadPeople = async (ids: string[]) => {
      const unique = [...new Set(ids)].sort();
      const found = unique.length ? await tx.select().from(calendarPeople).where(and(peopleScope, inArray(calendarPeople.id, unique))).orderBy(asc(calendarPeople.id)).for("update") : [];
      if (found.length !== unique.length) fail(404, "NOT_FOUND", "Service person not found");
      return found;
    };
    const loadBooking = async (id: string) => {
      const [found] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.calendarId, input.calendarId), eq(bookings.workspaceId, workspaceId)));
      if (!found) fail(404, "NOT_FOUND", "Booking not found"); return found;
    };
    const exceptions = (personId: string) => tx.select().from(availabilityExceptions).where(eq(availabilityExceptions.personId, personId)).limit(5001).then(items => page(items, 5000).items);
    const busyFor = (personId: string, range: Interval) => tx.select().from(bookings).where(and(eq(bookings.personId, personId), eq(bookings.workspaceId, workspaceId), eq(bookings.status, "confirmed"), lt(bookings.start, new Date(range.end)), gt(bookings.end, new Date(range.start)))).limit(5001).then(items => page(items, 5000).items);
    const activePerson = async (person: Person) => {
      if (person.archived) fail(409, "ARCHIVED", "The service person is archived");
      if (person.userId) {
        const [bound] = await tx.select({ id: user.id }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, organizationId), eq(member.userId, person.userId), eq(user.kind, "human"))).for("share", { of: member });
        if (!bound) fail(409, "INVALID_STATE", "The bound service person is no longer an active human member");
      }
    };
    const withinHours = (person: Person, rest: Awaited<ReturnType<typeof exceptions>>, interval: Interval) => openIntervals(person.timeZone, person.windows, rest, interval).some(window => window.start <= interval.start && window.end >= interval.end);
    const validateFuture = async (person: Person) => {
      const future = page(await tx.select().from(bookings).where(and(eq(bookings.personId, person.id), eq(bookings.status, "confirmed"), gt(bookings.end, deps.now()))).limit(5001), 5000).items;
      const rest = await exceptions(person.id);
      if (future.some(booking => !withinHours(person, rest, { start: +booking.start, end: +booking.end }))) fail(409, "RESOURCE_CONFLICT", "Working hours would invalidate an existing booking; reschedule or cancel it first");
    };
    const serializeBooking = async (booking: StoredBooking) => {
      let linkedRowId = booking.linkedRowId;
      if (linkedRowId) {
        const [row] = await tx.select({ workspaceId: tables.workspaceId, tableId: tables.id }).from(rows).innerJoin(tables, eq(rows.tableId, tables.id)).where(eq(rows.id, linkedRowId));
        if (!row || row.workspaceId !== workspaceId || principal && !principal.permissions.get(row.tableId)?.canRead) linkedRowId = null;
      }
      return { ...booking, workspaceId: undefined, start: booking.start.toISOString(), end: booking.end.toISOString(), linkedRowId };
    };
    let output: unknown;
    switch (command) {
      case "listCalendars": output = page((await tx.select().from(calendars).where(and(eq(calendars.workspaceId, workspaceId), input.includeArchived ? undefined : eq(calendars.archived, false))).orderBy(asc(calendars.id)).limit(501)).map(publicCalendar)); break;
      case "getCalendar": output = publicCalendar(calendar!); break;
      case "createCalendar": { const [saved] = await tx.insert(calendars).values({ workspaceId, organizationId, name: input.name, timeZone: input.timeZone }).returning(); output = publicCalendar(saved); break; }
      case "updateCalendar": case "archiveCalendar": {
        cas(calendar!.version, input.expectedVersion);
        if (command === "archiveCalendar") {
          const ids = (await tx.select({ id: bookings.personId }).from(bookings).where(eq(bookings.calendarId, calendar!.id))).map(row => row.id);
          await loadPeople(ids);
          const [future] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.calendarId, calendar!.id), eq(bookings.status, "confirmed"), gt(bookings.end, deps.now()))).limit(1);
          if (future) fail(409, "FUTURE_BOOKINGS", "Reschedule or cancel future bookings before archiving this calendar");
        }
        const [saved] = await tx.update(calendars).set({ ...(command === "archiveCalendar" ? { archived: true } : { name: input.name, timeZone: input.timeZone }), version: calendar!.version + 1 }).where(eq(calendars.id, calendar!.id)).returning(); output = publicCalendar(saved); break;
      }
      case "listCalendarPeople": output = page((await tx.select().from(calendarPeople).where(and(peopleScope, input.includeArchived ? undefined : eq(calendarPeople.archived, false))).orderBy(asc(calendarPeople.id)).limit(501)).map(serializePerson)); break;
      case "createCalendarPerson": {
        if (input.userId) {
          const [bound] = await tx.select({ id: user.id }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, organizationId), eq(user.id, input.userId), eq(user.kind, "human"))).for("share", { of: member });
          if (!bound) fail(400, "BAD_INPUT", "Bind an active human member userId");
          const [existing] = await tx.select({ id: calendarPeople.id }).from(calendarPeople).where(and(peopleScope, eq(calendarPeople.userId, input.userId)));
          if (existing) fail(409, "RESOURCE_CONFLICT", "This human member already has a stable service person record in this workspace");
        }
        const [saved] = await tx.insert(calendarPeople).values({ workspaceId, name: input.name, timeZone: input.timeZone, userId: input.userId ?? null }).returning(); output = serializePerson(saved); break;
      }
      case "getCalendarPerson": case "getWorkingHours": case "updateCalendarPerson": case "archiveCalendarPerson": case "setWorkingHours": {
        const [person] = await loadPeople([input.personId]);
        if (command === "getCalendarPerson") { output = serializePerson(person); break; }
        if (command === "getWorkingHours") { output = { personId: person.id, version: person.version, timeZone: person.timeZone, windows: person.windows }; break; }
        cas(person.version, input.expectedVersion);
        if (command === "archiveCalendarPerson") {
          const [future] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.personId, person.id), eq(bookings.status, "confirmed"), gt(bookings.end, deps.now()))).limit(1);
          if (future) fail(409, "FUTURE_BOOKINGS", "Reschedule or cancel future bookings before archiving this person");
        }
        const change = command === "setWorkingHours" ? { windows: input.windows } : command === "updateCalendarPerson" ? { name: input.name, timeZone: input.timeZone } : { archived: true };
        if (command !== "archiveCalendarPerson") await validateFuture({ ...person, ...change });
        const [saved] = await tx.update(calendarPeople).set({ ...change, version: person.version + 1 }).where(eq(calendarPeople.id, person.id)).returning(); output = serializePerson(saved); break;
      }
      case "listAvailabilityExceptions": case "setAvailabilityException": case "removeAvailabilityException": {
        const [person] = await loadPeople([input.personId]);
        if (command === "listAvailabilityExceptions") {
          output = page((await exceptions(person.id)).filter(item => item.date >= input.startDate && item.date <= input.endDate)); break;
        }
        if (input.exceptionId) {
          const [current] = await tx.select().from(availabilityExceptions).where(and(eq(availabilityExceptions.id, input.exceptionId), eq(availabilityExceptions.personId, person.id)));
          if (!current) fail(404, "NOT_FOUND", "Availability exception not found"); cas(current.version, input.expectedVersion);
          if (command === "removeAvailabilityException") { await tx.delete(availabilityExceptions).where(eq(availabilityExceptions.id, current.id)); output = { id: current.id, removed: true }; break; }
          [output] = await tx.update(availabilityExceptions).set({ date: input.date, intervals: input.intervals, version: current.version + 1 }).where(eq(availabilityExceptions.id, current.id)).returning();
        } else [output] = await tx.insert(availabilityExceptions).values({ personId: person.id, date: input.date, intervals: input.intervals }).returning();
        await validateFuture(person); break;
      }
      case "queryBookings": {
        const found = await tx.select().from(bookings).where(and(eq(bookings.calendarId, calendar!.id), lt(bookings.start, new Date(input.rangeEnd)), gt(bookings.end, new Date(input.rangeStart)), input.personId ? eq(bookings.personId, input.personId) : undefined, input.includeCancelled ? undefined : eq(bookings.status, "confirmed"))).orderBy(asc(bookings.start), asc(bookings.id)).limit(501);
        page(found); output = page(await Promise.all(found.map(serializeBooking))); break;
      }
      case "getBooking": output = await serializeBooking(await loadBooking(input.bookingId)); break;
      case "queryAvailability": case "checkBookingConflicts": {
        const [person] = await loadPeople([input.personId]); await activePerson(person);
        const range = command === "queryAvailability" ? { start: Date.parse(input.rangeStart), end: Date.parse(input.rangeEnd) } : parseBookingTime(input.time);
        const open = openIntervals(person.timeZone, person.windows, await exceptions(person.id), range);
        const busy = (await busyFor(person.id, range)).map(row => ({ start: +row.start, end: +row.end }));
        if (command === "checkBookingConflicts") {
          const reason = !open.some(slot => slot.start <= range.start && slot.end >= range.end) ? "OUTSIDE_AVAILABILITY" : busy.some(slot => overlaps(slot, range)) ? "RESOURCE_CONFLICT" : null;
          output = { available: reason === null, reason, snapshot: true }; break;
        }
        const slots: { start: string; end: string }[] = [];
        for (const slot of subtractBusy(open, busy)) for (let start = slot.start; start + input.durationMinutes * 60000 <= slot.end; start += input.stepMinutes * 60000) {
          if (slots.length >= 5000) fail(400, "QUERY_LIMIT", "Availability exceeds 5000 slots; reduce the range or increase the step");
          slots.push({ start: new Date(start).toISOString(), end: new Date(start + input.durationMinutes * 60000).toISOString() });
        }
        output = { slots, complete: true, timeZone: person.timeZone, durationMinutes: input.durationMinutes, snapshot: true }; break;
      }
      case "createBooking": case "rescheduleBooking": case "cancelBooking": case "batchBookings": {
        const operations: any[] = command === "batchBookings" ? input.operations : [{ ...input, kind: command === "createBooking" ? "create" : command === "rescheduleBooking" ? "reschedule" : "cancel" }];
        const ids = operations.filter(op => op.kind !== "create").map(op => op.bookingId);
        if (new Set(ids).size !== ids.length) fail(400, "BAD_INPUT", "A batch cannot change the same booking twice");
        const initial = new Map<string, StoredBooking>();
        for (const id of [...ids].sort()) initial.set(id, await loadBooking(id));
        const people = await loadPeople(operations.map(op => op.kind === "create" ? op.personId : initial.get(op.bookingId)!.personId));
        // Stable person locks precede booking locks; reload after waiting for any earlier writer.
        for (const id of [...ids].sort()) {
          const [current] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update"); initial.set(id, current);
        }
        const changed: StoredBooking[] = [];
        for (const operation of operations) {
          if (operation.kind === "create") {
            if (operation.linkedRowId) {
              const [row] = await tx.select({ workspaceId: tables.workspaceId, tableId: tables.id }).from(rows).innerJoin(tables, eq(rows.tableId, tables.id)).where(and(eq(rows.id, operation.linkedRowId), eq(tables.organizationId, organizationId))).for("share", { of: rows });
              if (!row || row.workspaceId !== workspaceId) fail(404, "NOT_FOUND", "Linked record not found");
              if (principal && !principal.tableIds.has(row.tableId)) fail(404, "NOT_FOUND", "Linked record not found");
              if (principal && !principal.permissions.get(row.tableId)?.canRead) fail(403, "FORBIDDEN", "Linking a record requires table read permission");
            }
            const time = parseBookingTime(operation.time);
            changed.push({ id: deps.uuid(), workspaceId, calendarId: calendar!.id, personId: operation.personId, title: operation.title, start: new Date(time.start), end: new Date(time.end), timeZone: operation.time.timeZone, status: "confirmed", version: 1, revision: 1, linkedRowId: operation.linkedRowId ?? null });
          } else {
            const current = initial.get(operation.bookingId)!; cas(current.version, operation.expectedVersion);
            if (current.status !== "confirmed") fail(409, "INVALID_STATE", "Only confirmed bookings can be rescheduled or cancelled");
            const time = operation.kind === "reschedule" ? parseBookingTime(operation.time) : { start: +current.start, end: +current.end };
            changed.push({ ...current, start: new Date(time.start), end: new Date(time.end), timeZone: operation.time?.timeZone ?? current.timeZone, status: operation.kind === "cancel" ? "cancelled" : "confirmed", version: current.version + 1, revision: current.revision + 1 });
          }
        }
        for (const person of people) {
          const candidates = changed.filter(booking => booking.personId === person.id && booking.status === "confirmed");
          if (!candidates.length) continue;
          await activePerson(person);
          const rest = await exceptions(person.id);
          const range = { start: Math.min(...candidates.map(b => +b.start)), end: Math.max(...candidates.map(b => +b.end)) };
          const existing = (await busyFor(person.id, range)).filter(booking => !initial.has(booking.id));
          for (const candidate of candidates) {
            const time = { start: +candidate.start, end: +candidate.end };
            if (!withinHours(person, rest, time)) fail(409, "OUTSIDE_AVAILABILITY", "The booking is outside the person's working hours or overlaps time off");
            if ([...existing, ...candidates.filter(b => b.id !== candidate.id)].some(b => overlaps(time, { start: +b.start, end: +b.end }))) fail(409, "RESOURCE_CONFLICT", "The service person is already booked during this time");
          }
        }
        for (const booking of changed) {
          if (initial.has(booking.id)) await tx.update(bookings).set(booking).where(eq(bookings.id, booking.id));
          else await tx.insert(bookings).values(booking);
        }
        output = command === "batchBookings" ? { receipts: changed.map(receipt) } : receipt(changed[0]); break;
      }
    }
    if (requestId) await tx.update(calendarReceipts).set({ result: output }).where(eq(calendarReceipts.id, requestId));
    return output;
  }).catch(calendarDatabaseError);
  return result as CalendarResults[K];
}

export function memberCalendarCommand<K extends CalendarCommand>(deps: CommandDependencies, command: K, input: CalendarCommands[K] & Identity, tx?: Transaction) {
  const { organizationId, actorId, ...raw } = input;
  if (!organizationId || !actorId) fail(403, "FORBIDDEN", "A current workspace member is required");
  return executeCalendar(deps, { kind: "member", organizationId, actorId }, command, raw, tx);
}
