import * as service from "@tabdo/backend/automation/scheduled-runs";
import { runtimeDependencies, backendCall } from "../services/backend-facade.js";
type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
export const listScheduledRuns = (...args: Arguments<typeof service.listScheduledRuns>) => backendCall(() => service.listScheduledRuns(runtimeDependencies(), ...args));
export const getScheduledRunThread = (...args: Arguments<typeof service.getScheduledRunThread>) => backendCall(() => service.getScheduledRunThread(runtimeDependencies(), ...args));
