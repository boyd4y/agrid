import * as service from "../business/agent/executions.js";
import { businessCall, runtimeDependencies } from "../services/dependencies.js";
export type { NativeExecutionReference, AcceptedExecution, LoadedNativeExecution } from "../business/agent/executions.js";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const acceptNativeExecution = async (...args: Arguments<typeof service.acceptNativeExecution>) =>
  businessCall(() => service.acceptNativeExecution(runtimeDependencies(), ...args));
export const loadNativeExecution = async (...args: Arguments<typeof service.loadNativeExecution>) =>
  businessCall(() => service.loadNativeExecution(runtimeDependencies(), ...args));
export const recoverAcceptedNativeExecution = async (...args: Arguments<typeof service.recoverAcceptedNativeExecution>) =>
  businessCall(() => service.recoverAcceptedNativeExecution(runtimeDependencies(), ...args));
export const claimNativeExecution = async (...args: Arguments<typeof service.claimNativeExecution>) =>
  businessCall(() => service.claimNativeExecution(runtimeDependencies(), ...args));
export const appendNativeExecutionChunk = async (...args: Arguments<typeof service.appendNativeExecutionChunk>) =>
  businessCall(() => service.appendNativeExecutionChunk(runtimeDependencies(), ...args));
export const settleNativeExecution = async (...args: Arguments<typeof service.settleNativeExecution>) =>
  businessCall(() => service.settleNativeExecution(runtimeDependencies(), ...args));
export const readNativeExecutionOutput = async (...args: Arguments<typeof service.readNativeExecutionOutput>) =>
  businessCall(() => service.readNativeExecutionOutput(runtimeDependencies(), ...args));
