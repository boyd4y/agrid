import * as implementation from "../business/commands/calendar-views.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";
type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
export const createCalendarView = (...args: Arguments<typeof implementation.createCalendarView>) => businessCall(() => implementation.createCalendarView(commandDependencies(), ...args));
export const updateCalendarView = (...args: Arguments<typeof implementation.updateCalendarView>) => businessCall(() => implementation.updateCalendarView(commandDependencies(), ...args));
export const queryCalendarView = (...args: Arguments<typeof implementation.queryCalendarView>) => businessCall(() => implementation.queryCalendarView(commandDependencies(), ...args));
