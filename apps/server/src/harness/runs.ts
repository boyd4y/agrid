import * as service from "../business/agent/runs.js";
import { businessCall, runtimeDependencies } from "../services/dependencies.js";
export type { AgentRun } from "../business/agent/runs.js";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const beginNativeRun = async (...args: Arguments<typeof service.beginNativeRun>) =>
  businessCall(() => service.beginNativeRun(runtimeDependencies(), ...args));
export const recordRunActivity = async (...args: Arguments<typeof service.recordRunActivity>) =>
  businessCall(() => service.recordRunActivity(runtimeDependencies(), ...args));
export const failNativeRun = async (...args: Arguments<typeof service.failNativeRun>) =>
  businessCall(() => service.failNativeRun(runtimeDependencies(), ...args));
export const runCancellationRequested = async (...args: Arguments<typeof service.runCancellationRequested>) =>
  businessCall(() => service.runCancellationRequested(runtimeDependencies(), ...args));
export const listNativeRuns = async (...args: Arguments<typeof service.listNativeRuns>) =>
  businessCall(() => service.listNativeRuns(runtimeDependencies(), ...args));
export const requestRunCancellation = async (...args: Arguments<typeof service.requestRunCancellation>) =>
  businessCall(() => service.requestRunCancellation(runtimeDependencies(), ...args));
export const listNativeRunEvents = async (...args: Arguments<typeof service.listNativeRunEvents>) =>
  businessCall(() => service.listNativeRunEvents(runtimeDependencies(), ...args));
