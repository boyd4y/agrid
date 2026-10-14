import * as service from "@tabdo/backend/agent/executions";
import { backendCall, runtimeDependencies } from "../services/backend-facade.js";
export type { NativeExecutionReference, AcceptedExecution, LoadedNativeExecution } from "@tabdo/backend/agent/executions";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const acceptNativeExecution = async (...args: Arguments<typeof service.acceptNativeExecution>) =>
  backendCall(() => service.acceptNativeExecution(runtimeDependencies(), ...args));
export const loadNativeExecution = async (...args: Arguments<typeof service.loadNativeExecution>) =>
  backendCall(() => service.loadNativeExecution(runtimeDependencies(), ...args));
export const recoverAcceptedNativeExecution = async (...args: Arguments<typeof service.recoverAcceptedNativeExecution>) =>
  backendCall(() => service.recoverAcceptedNativeExecution(runtimeDependencies(), ...args));
export const claimNativeExecution = async (...args: Arguments<typeof service.claimNativeExecution>) =>
  backendCall(() => service.claimNativeExecution(runtimeDependencies(), ...args));
export const appendNativeExecutionChunk = async (...args: Arguments<typeof service.appendNativeExecutionChunk>) =>
  backendCall(() => service.appendNativeExecutionChunk(runtimeDependencies(), ...args));
export const settleNativeExecution = async (...args: Arguments<typeof service.settleNativeExecution>) =>
  backendCall(() => service.settleNativeExecution(runtimeDependencies(), ...args));
export const readNativeExecutionOutput = async (...args: Arguments<typeof service.readNativeExecutionOutput>) =>
  backendCall(() => service.readNativeExecutionOutput(runtimeDependencies(), ...args));
