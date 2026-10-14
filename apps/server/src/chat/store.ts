import * as service from "@tabdo/backend/chat/store";
import { backendCall, runtimeDependencies } from "../services/backend-facade.js";
export type { StoredMessage } from "@tabdo/backend/chat/store";
export { threadScope } from "@tabdo/backend/chat/store";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const requireThread = async (...args: Arguments<typeof service.requireThread>) =>
  backendCall(() => service.requireThread(runtimeDependencies(), ...args));
export const saveMessageInTransaction = async (...args: Arguments<typeof service.saveMessageInTransaction>) =>
  backendCall(() => service.saveMessageInTransaction(runtimeDependencies(), ...args));
export const saveMessage = async (...args: Arguments<typeof service.saveMessage>) =>
  backendCall(() => service.saveMessage(runtimeDependencies(), ...args));
export const loadMessages = async (...args: Arguments<typeof service.loadMessages>) =>
  backendCall(() => service.loadMessages(runtimeDependencies(), ...args));
