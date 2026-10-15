import * as service from "../business/chat/store.js";
import { businessCall, runtimeDependencies } from "../services/dependencies.js";
export type { StoredMessage } from "../business/chat/store.js";
export { threadScope } from "../business/chat/store.js";

type Arguments<T extends (...args: never[]) => unknown> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : never;

// Application facade: resource/HTTP composition only; business SQL has one backend implementation.
export const requireThread = async (...args: Arguments<typeof service.requireThread>) =>
  businessCall(() => service.requireThread(runtimeDependencies(), ...args));
export const saveMessageInTransaction = async (...args: Arguments<typeof service.saveMessageInTransaction>) =>
  businessCall(() => service.saveMessageInTransaction(runtimeDependencies(), ...args));
export const saveMessage = async (...args: Arguments<typeof service.saveMessage>) =>
  businessCall(() => service.saveMessage(runtimeDependencies(), ...args));
export const loadMessages = async (...args: Arguments<typeof service.loadMessages>) =>
  businessCall(() => service.loadMessages(runtimeDependencies(), ...args));
