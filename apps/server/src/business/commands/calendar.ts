import type { CalendarCommands } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { memberCalendarCommand } from "../calendar/service.js";
type Identity = { organizationId?: string; actorId?: string };

export const listCalendars = (deps: CommandDependencies, input: CalendarCommands["listCalendars"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listCalendars", input, tx);
export const getCalendar = (deps: CommandDependencies, input: CalendarCommands["getCalendar"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getCalendar", input, tx);
export const createCalendar = (deps: CommandDependencies, input: CalendarCommands["createCalendar"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "createCalendar", input, tx);
export const updateCalendar = (deps: CommandDependencies, input: CalendarCommands["updateCalendar"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "updateCalendar", input, tx);
export const archiveCalendar = (deps: CommandDependencies, input: CalendarCommands["archiveCalendar"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "archiveCalendar", input, tx);
export const listCalendarPeople = (deps: CommandDependencies, input: CalendarCommands["listCalendarPeople"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listCalendarPeople", input, tx);
export const getCalendarPerson = (deps: CommandDependencies, input: CalendarCommands["getCalendarPerson"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getCalendarPerson", input, tx);
export const createCalendarPerson = (deps: CommandDependencies, input: CalendarCommands["createCalendarPerson"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "createCalendarPerson", input, tx);
export const updateCalendarPerson = (deps: CommandDependencies, input: CalendarCommands["updateCalendarPerson"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "updateCalendarPerson", input, tx);
export const archiveCalendarPerson = (deps: CommandDependencies, input: CalendarCommands["archiveCalendarPerson"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "archiveCalendarPerson", input, tx);
export const getWorkingHours = (deps: CommandDependencies, input: CalendarCommands["getWorkingHours"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getWorkingHours", input, tx);
export const setWorkingHours = (deps: CommandDependencies, input: CalendarCommands["setWorkingHours"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "setWorkingHours", input, tx);
export const listAvailabilityExceptions = (deps: CommandDependencies, input: CalendarCommands["listAvailabilityExceptions"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listAvailabilityExceptions", input, tx);
export const setAvailabilityException = (deps: CommandDependencies, input: CalendarCommands["setAvailabilityException"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "setAvailabilityException", input, tx);
export const removeAvailabilityException = (deps: CommandDependencies, input: CalendarCommands["removeAvailabilityException"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "removeAvailabilityException", input, tx);
export const queryBookings = (deps: CommandDependencies, input: CalendarCommands["queryBookings"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "queryBookings", input, tx);
export const getBooking = (deps: CommandDependencies, input: CalendarCommands["getBooking"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getBooking", input, tx);
export const createBooking = (deps: CommandDependencies, input: CalendarCommands["createBooking"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "createBooking", input, tx);
export const rescheduleBooking = (deps: CommandDependencies, input: CalendarCommands["rescheduleBooking"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "rescheduleBooking", input, tx);
export const cancelBooking = (deps: CommandDependencies, input: CalendarCommands["cancelBooking"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "cancelBooking", input, tx);
export const queryAvailability = (deps: CommandDependencies, input: CalendarCommands["queryAvailability"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "queryAvailability", input, tx);
export const checkBookingConflicts = (deps: CommandDependencies, input: CalendarCommands["checkBookingConflicts"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "checkBookingConflicts", input, tx);
export const batchBookings = (deps: CommandDependencies, input: CalendarCommands["batchBookings"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "batchBookings", input, tx);

export const queryScheduledOccurrences = (deps: CommandDependencies, input: CalendarCommands["queryScheduledOccurrences"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "queryScheduledOccurrences", input, tx);

export const setBookingReminders = (deps: CommandDependencies, input: CalendarCommands["setBookingReminders"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "setBookingReminders", input, tx);

export const listBookingReminders = (deps: CommandDependencies, input: CalendarCommands["listBookingReminders"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listBookingReminders", input, tx);

export const listCalendarSubscriptions = (deps: CommandDependencies, input: CalendarCommands["listCalendarSubscriptions"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listCalendarSubscriptions", input, tx);
export const getCalendarSubscription = (deps: CommandDependencies, input: CalendarCommands["getCalendarSubscription"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getCalendarSubscription", input, tx);
export const createCalendarSubscription = (deps: CommandDependencies, input: CalendarCommands["createCalendarSubscription"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "createCalendarSubscription", input, tx);
export const updateCalendarSubscription = (deps: CommandDependencies, input: CalendarCommands["updateCalendarSubscription"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "updateCalendarSubscription", input, tx);
export const revokeCalendarSubscription = (deps: CommandDependencies, input: CalendarCommands["revokeCalendarSubscription"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "revokeCalendarSubscription", input, tx);
export const rotateCalendarSubscriptionSecret = (deps: CommandDependencies, input: CalendarCommands["rotateCalendarSubscriptionSecret"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "rotateCalendarSubscriptionSecret", input, tx);
export const listCalendarDeliveries = (deps: CommandDependencies, input: CalendarCommands["listCalendarDeliveries"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "listCalendarDeliveries", input, tx);
export const getCalendarDelivery = (deps: CommandDependencies, input: CalendarCommands["getCalendarDelivery"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "getCalendarDelivery", input, tx);
export const retryCalendarDelivery = (deps: CommandDependencies, input: CalendarCommands["retryCalendarDelivery"] & Identity, tx?: Transaction) => memberCalendarCommand(deps, "retryCalendarDelivery", input, tx);
