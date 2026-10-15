import * as service from "../business/automation/scheduled-runs.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
export const listScheduledRuns = (...args: Arguments<typeof service.listScheduledRuns>) => businessCall(() => service.listScheduledRuns(runtimeDependencies(), ...args));
export const getScheduledRunThread = (...args: Arguments<typeof service.getScheduledRunThread>) => businessCall(() => service.getScheduledRunThread(runtimeDependencies(), ...args));
