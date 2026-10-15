import * as implementation from "../business/automation/schedule.js";
import { commandDependencies, businessCall, mapServiceError } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export function schedulePreview(cron: string, timeZone: string, now = new Date(), count = 3) {
  try { return implementation.schedulePreview(cron, timeZone, now, count); } catch (error) { return mapServiceError(error); }
}
export const syncSchedule = (...args: Arguments<typeof implementation.syncSchedule>) =>
  businessCall(() => implementation.syncSchedule(commandDependencies(), ...args));
export const dispatchDueSchedules = (...args: Arguments<typeof implementation.dispatchDueSchedules>) =>
  businessCall(() => implementation.dispatchDueSchedules(commandDependencies(), ...args));
