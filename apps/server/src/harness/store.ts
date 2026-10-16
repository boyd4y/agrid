import * as service from "../business/agent/runtime-store.js";
import { businessCall, runtimeDependencies } from "../services/dependencies.js";
export type { RuntimeLease, RuntimeRecord, RuntimeCheckpoint } from "../business/agent/runtime-store.js";
export { NOT_INVOKED } from "../business/agent/runtime-store.js";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const claimRuntimeLease = async (...args: Arguments<typeof service.claimRuntimeLease>) =>
  businessCall(() => service.claimRuntimeLease(runtimeDependencies(), ...args));
export const renewRuntimeLease = async (...args: Arguments<typeof service.renewRuntimeLease>) =>
  businessCall(() => service.renewRuntimeLease(runtimeDependencies(), ...args));
export const releaseRuntimeLease = async (...args: Arguments<typeof service.releaseRuntimeLease>) =>
  businessCall(() => service.releaseRuntimeLease(runtimeDependencies(), ...args));
export const prepareRuntimeRecord = async (...args: Arguments<typeof service.prepareRuntimeRecord>) =>
  businessCall(() => service.prepareRuntimeRecord(runtimeDependencies(), ...args));
export const saveRuntimeCheckpoint = async (...args: Arguments<typeof service.saveRuntimeCheckpoint>) =>
  businessCall(() => service.saveRuntimeCheckpoint(runtimeDependencies(), ...args));
export const completeRuntimeTurn = async (...args: Arguments<typeof service.completeRuntimeTurn>) =>
  businessCall(() => service.completeRuntimeTurn(runtimeDependencies(), ...args));
export const completeUninvokedRun = async (...args: Arguments<typeof service.completeUninvokedRun>) =>
  businessCall(() => service.completeUninvokedRun(runtimeDependencies(), ...args));

export async function withRuntimeLease<T>(lease: service.RuntimeLease, work: (transaction: import("../business/db/types.js").Transaction) => Promise<T>): Promise<T> {
  return businessCall(() => service.withRuntimeLease(runtimeDependencies(), lease, work));
}

export const bindRuntimeSandbox = async (...args: Arguments<typeof service.bindRuntimeSandbox>) =>
  businessCall(() => service.bindRuntimeSandbox(runtimeDependencies(), ...args));
export const discardUninvokedSandbox = async (...args: Arguments<typeof service.discardUninvokedSandbox>) =>
  businessCall(() => service.discardUninvokedSandbox(runtimeDependencies(), ...args));
