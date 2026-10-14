import * as service from "@tabdo/backend/agent/runtime-store";
import { backendCall, runtimeDependencies } from "../services/backend-facade.js";
export type { RuntimeLease, RuntimeRecord, RuntimeCheckpoint } from "@tabdo/backend/agent/runtime-store";
export { NOT_INVOKED } from "@tabdo/backend/agent/runtime-store";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const claimRuntimeLease = async (...args: Arguments<typeof service.claimRuntimeLease>) =>
  backendCall(() => service.claimRuntimeLease(runtimeDependencies(), ...args));
export const renewRuntimeLease = async (...args: Arguments<typeof service.renewRuntimeLease>) =>
  backendCall(() => service.renewRuntimeLease(runtimeDependencies(), ...args));
export const releaseRuntimeLease = async (...args: Arguments<typeof service.releaseRuntimeLease>) =>
  backendCall(() => service.releaseRuntimeLease(runtimeDependencies(), ...args));
export const prepareRuntimeRecord = async (...args: Arguments<typeof service.prepareRuntimeRecord>) =>
  backendCall(() => service.prepareRuntimeRecord(runtimeDependencies(), ...args));
export const saveRuntimeCheckpoint = async (...args: Arguments<typeof service.saveRuntimeCheckpoint>) =>
  backendCall(() => service.saveRuntimeCheckpoint(runtimeDependencies(), ...args));
export const completeRuntimeTurn = async (...args: Arguments<typeof service.completeRuntimeTurn>) =>
  backendCall(() => service.completeRuntimeTurn(runtimeDependencies(), ...args));
export const completeUninvokedPiRun = async (...args: Arguments<typeof service.completeUninvokedPiRun>) =>
  backendCall(() => service.completeUninvokedPiRun(runtimeDependencies(), ...args));

export async function withRuntimeLease<T>(lease: service.RuntimeLease, work: (transaction: import("@tabdo/backend/database-types").Transaction) => Promise<T>): Promise<T> {
  return backendCall(() => service.withRuntimeLease(runtimeDependencies(), lease, work));
}
