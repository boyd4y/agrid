import * as implementation from "../business/commands/calendar.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";
type Args<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const listCalendars = (...args: Args<typeof implementation.listCalendars>) => businessCall(() => implementation.listCalendars(commandDependencies(), ...args));
export const getCalendar = (...args: Args<typeof implementation.getCalendar>) => businessCall(() => implementation.getCalendar(commandDependencies(), ...args));
export const createCalendar = (...args: Args<typeof implementation.createCalendar>) => businessCall(() => implementation.createCalendar(commandDependencies(), ...args));
export const updateCalendar = (...args: Args<typeof implementation.updateCalendar>) => businessCall(() => implementation.updateCalendar(commandDependencies(), ...args));
export const archiveCalendar = (...args: Args<typeof implementation.archiveCalendar>) => businessCall(() => implementation.archiveCalendar(commandDependencies(), ...args));
export const listCalendarPeople = (...args: Args<typeof implementation.listCalendarPeople>) => businessCall(() => implementation.listCalendarPeople(commandDependencies(), ...args));
export const getCalendarPerson = (...args: Args<typeof implementation.getCalendarPerson>) => businessCall(() => implementation.getCalendarPerson(commandDependencies(), ...args));
export const createCalendarPerson = (...args: Args<typeof implementation.createCalendarPerson>) => businessCall(() => implementation.createCalendarPerson(commandDependencies(), ...args));
export const updateCalendarPerson = (...args: Args<typeof implementation.updateCalendarPerson>) => businessCall(() => implementation.updateCalendarPerson(commandDependencies(), ...args));
export const archiveCalendarPerson = (...args: Args<typeof implementation.archiveCalendarPerson>) => businessCall(() => implementation.archiveCalendarPerson(commandDependencies(), ...args));
export const getWorkingHours = (...args: Args<typeof implementation.getWorkingHours>) => businessCall(() => implementation.getWorkingHours(commandDependencies(), ...args));
export const setWorkingHours = (...args: Args<typeof implementation.setWorkingHours>) => businessCall(() => implementation.setWorkingHours(commandDependencies(), ...args));
export const listAvailabilityExceptions = (...args: Args<typeof implementation.listAvailabilityExceptions>) => businessCall(() => implementation.listAvailabilityExceptions(commandDependencies(), ...args));
export const setAvailabilityException = (...args: Args<typeof implementation.setAvailabilityException>) => businessCall(() => implementation.setAvailabilityException(commandDependencies(), ...args));
export const removeAvailabilityException = (...args: Args<typeof implementation.removeAvailabilityException>) => businessCall(() => implementation.removeAvailabilityException(commandDependencies(), ...args));
export const queryBookings = (...args: Args<typeof implementation.queryBookings>) => businessCall(() => implementation.queryBookings(commandDependencies(), ...args));
export const getBooking = (...args: Args<typeof implementation.getBooking>) => businessCall(() => implementation.getBooking(commandDependencies(), ...args));
export const createBooking = (...args: Args<typeof implementation.createBooking>) => businessCall(() => implementation.createBooking(commandDependencies(), ...args));
export const rescheduleBooking = (...args: Args<typeof implementation.rescheduleBooking>) => businessCall(() => implementation.rescheduleBooking(commandDependencies(), ...args));
export const cancelBooking = (...args: Args<typeof implementation.cancelBooking>) => businessCall(() => implementation.cancelBooking(commandDependencies(), ...args));
export const queryAvailability = (...args: Args<typeof implementation.queryAvailability>) => businessCall(() => implementation.queryAvailability(commandDependencies(), ...args));
export const checkBookingConflicts = (...args: Args<typeof implementation.checkBookingConflicts>) => businessCall(() => implementation.checkBookingConflicts(commandDependencies(), ...args));
export const batchBookings = (...args: Args<typeof implementation.batchBookings>) => businessCall(() => implementation.batchBookings(commandDependencies(), ...args));

export const queryScheduledOccurrences = (...args: Args<typeof implementation.queryScheduledOccurrences>) => businessCall(() => implementation.queryScheduledOccurrences(commandDependencies(), ...args));

export const setBookingReminders = (...args: Args<typeof implementation.setBookingReminders>) => businessCall(() => implementation.setBookingReminders(commandDependencies(), ...args));

export const listBookingReminders = (...args: Args<typeof implementation.listBookingReminders>) => businessCall(() => implementation.listBookingReminders(commandDependencies(), ...args));

export const listCalendarSubscriptions = (...args: Args<typeof implementation.listCalendarSubscriptions>) => businessCall(() => implementation.listCalendarSubscriptions(commandDependencies(), ...args));
export const getCalendarSubscription = (...args: Args<typeof implementation.getCalendarSubscription>) => businessCall(() => implementation.getCalendarSubscription(commandDependencies(), ...args));
export const createCalendarSubscription = (...args: Args<typeof implementation.createCalendarSubscription>) => businessCall(() => implementation.createCalendarSubscription(commandDependencies(), ...args));
export const updateCalendarSubscription = (...args: Args<typeof implementation.updateCalendarSubscription>) => businessCall(() => implementation.updateCalendarSubscription(commandDependencies(), ...args));
export const revokeCalendarSubscription = (...args: Args<typeof implementation.revokeCalendarSubscription>) => businessCall(() => implementation.revokeCalendarSubscription(commandDependencies(), ...args));
export const rotateCalendarSubscriptionSecret = (...args: Args<typeof implementation.rotateCalendarSubscriptionSecret>) => businessCall(() => implementation.rotateCalendarSubscriptionSecret(commandDependencies(), ...args));
export const listCalendarDeliveries = (...args: Args<typeof implementation.listCalendarDeliveries>) => businessCall(() => implementation.listCalendarDeliveries(commandDependencies(), ...args));
export const getCalendarDelivery = (...args: Args<typeof implementation.getCalendarDelivery>) => businessCall(() => implementation.getCalendarDelivery(commandDependencies(), ...args));
export const retryCalendarDelivery = (...args: Args<typeof implementation.retryCalendarDelivery>) => businessCall(() => implementation.retryCalendarDelivery(commandDependencies(), ...args));
