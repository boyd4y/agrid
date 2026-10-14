import * as service from "@tabdo/backend/agent/runs";
import { backendCall, runtimeDependencies } from "../services/backend-facade.js";
export type { AgentRun } from "@tabdo/backend/agent/runs";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const beginNativeRun = async (...args: Arguments<typeof service.beginNativeRun>) =>
  backendCall(() => service.beginNativeRun(runtimeDependencies(), ...args));
export const recordRunActivity = async (...args: Arguments<typeof service.recordRunActivity>) =>
  backendCall(() => service.recordRunActivity(runtimeDependencies(), ...args));
export const failNativeRun = async (...args: Arguments<typeof service.failNativeRun>) =>
  backendCall(() => service.failNativeRun(runtimeDependencies(), ...args));
export const runCancellationRequested = async (...args: Arguments<typeof service.runCancellationRequested>) =>
  backendCall(() => service.runCancellationRequested(runtimeDependencies(), ...args));
export const listNativeRuns = async (...args: Arguments<typeof service.listNativeRuns>) =>
  backendCall(() => service.listNativeRuns(runtimeDependencies(), ...args));
export const requestRunCancellation = async (...args: Arguments<typeof service.requestRunCancellation>) =>
  backendCall(() => service.requestRunCancellation(runtimeDependencies(), ...args));
export const listNativeRunEvents = async (...args: Arguments<typeof service.listNativeRunEvents>) =>
  backendCall(() => service.listNativeRunEvents(runtimeDependencies(), ...args));
