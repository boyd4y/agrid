import { ServiceError } from "../errors.js";
import { z } from "zod";
import { CALENDAR_PERMISSION_OPERATIONS, type CalendarCommand, type CalendarPermission } from "@tabdo/shared";

// Accepted only for older callers. Never included in the public key summaries.
export const legacyCalendarPermissionSchema = z.strictObject({ calendarId: z.uuid(), canRead: z.boolean(), canReadAvailability: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canCancel: z.boolean(), canManage: z.boolean(), canTriggerAgent: z.boolean().optional(), canSubscribe: z.boolean().optional(), canReadDeliveries: z.boolean().optional(), canManageSubscriptions: z.boolean().optional() }).refine(v => Object.entries(v).some(([k, v]) => k.startsWith("can") && v === true));
export type CalendarOperation = typeof CALENDAR_PERMISSION_OPERATIONS[number];
export type LegacyCalendarPermission = z.infer<typeof legacyCalendarPermissionSchema>;
export type CalendarGrant = LegacyCalendarPermission & { crudPermissions?: Partial<Pick<CalendarPermission, CalendarOperation>> | null };

/** An explicit CRUD choice overrides only that group. Untouched legacy checks remain exact. */
export function calendarGrantAllows(grant: CalendarGrant | undefined, operation: CalendarOperation, legacy: (grant: CalendarGrant) => boolean) {
  return !!grant && (grant.crudPermissions?.[operation] ?? legacy(grant));
}
export const canDeliverCalendar = (grant: CalendarGrant | undefined) => calendarGrantAllows(grant, "canRead", g => g.canRead) && calendarGrantAllows(grant, "canCreate", g => !!g.canRead && !!g.canSubscribe);
export const canRunCalendarReminder = (grant: CalendarGrant | undefined) => calendarGrantAllows(grant, "canUpdate", g => !!g.canUpdate && !!g.canTriggerAgent);

/** Checked only when EVERY operation represented by a public checkbox is already allowed. */
export function publicCalendarPermission(grant: CalendarGrant): CalendarPermission {
  const result: CalendarPermission = { calendarId: grant.calendarId,
    canRead: calendarGrantAllows(grant, "canRead", g => g.canRead && g.canReadAvailability && !!g.canSubscribe && !!g.canReadDeliveries),
    canUpdate: calendarGrantAllows(grant, "canUpdate", g => g.canUpdate && g.canManage && !!g.canManageSubscriptions && !!g.canTriggerAgent && g.canRead && !!g.canSubscribe),
    canDelete: calendarGrantAllows(grant, "canDelete", g => g.canCancel && g.canManage && !!g.canManageSubscriptions && g.canUpdate && !!g.canTriggerAgent),
    canCreate: calendarGrantAllows(grant, "canCreate", g => g.canCreate && g.canManage && !!g.canSubscribe && g.canRead),
  };
  const partialOperations = CALENDAR_PERMISSION_OPERATIONS.filter(op => grant.crudPermissions?.[op] === undefined && !result[op] && ({
    // Legacy calendar listing allowed every assigned target, even a write-only grant.
    canRead: Object.entries(grant).some(([name, value]) => name.startsWith("can") && value === true),
    canCreate: grant.canCreate || grant.canManage || grant.canRead && grant.canSubscribe,
    canUpdate: grant.canUpdate || grant.canManage || grant.canManageSubscriptions,
    canDelete: grant.canCancel || grant.canManage || grant.canManageSubscriptions || grant.canUpdate && grant.canTriggerAgent,
  })[op]);
  return partialOperations.length ? { ...result, partialOperations } : result;
}

export function storedCalendarPermission(input: CalendarPermission | LegacyCalendarPermission, previous?: CalendarGrant): CalendarGrant {
  if (!("canDelete" in input)) return { ...input, crudPermissions: null };
  const { calendarId, partialOperations, ...choices } = input;
  if (!previous) {
    if (!CALENDAR_PERMISSION_OPERATIONS.some(op => choices[op])) throw new ServiceError(400, { message: "Choose at least one calendar operation" });
    return { calendarId, canRead: false, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, crudPermissions: choices };
  }
  const projected = publicCalendarPermission(previous), overrides = { ...previous.crudPermissions };
  for (const op of CALENDAR_PERMISSION_OPERATIONS) {
    const keepPartial = projected.partialOperations?.includes(op) && partialOperations?.includes(op) && !choices[op];
    if (!keepPartial && (choices[op] !== projected[op] || projected.partialOperations?.includes(op))) overrides[op] = choices[op];
  }
  return { ...previous, crudPermissions: Object.keys(overrides).length ? overrides : null };
}

export function calendarCommandOperation(command: CalendarCommand, input: Record<string, any>): CalendarOperation {
  if (command === "setBookingReminders") return input.reminders.length ? "canUpdate" : "canDelete";
  if (command === "setAvailabilityException") return input.exceptionId === undefined ? "canCreate" : "canUpdate";
  if (["createCalendarPerson", "createBooking", "createCalendarSubscription"].includes(command)) return "canCreate";
  if (["archiveCalendar", "archiveCalendarPerson", "removeAvailabilityException", "cancelBooking", "revokeCalendarSubscription"].includes(command)) return "canDelete";
  if (["updateCalendar", "updateCalendarPerson", "setWorkingHours", "rescheduleBooking", "updateCalendarSubscription", "rotateCalendarSubscriptionSecret", "retryCalendarDelivery"].includes(command)) return "canUpdate";
  return "canRead";
}
