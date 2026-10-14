import * as implementation from "@tabdo/backend/commands/batch-relations";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const batchSetRelations = (...args: Arguments<typeof implementation.batchSetRelations>) =>
  backendCall(() => implementation.batchSetRelations(commandDependencies(), ...args));
export const batchAddRelations = (...args: Arguments<typeof implementation.batchAddRelations>) =>
  backendCall(() => implementation.batchAddRelations(commandDependencies(), ...args));
export const batchRemoveRelations = (...args: Arguments<typeof implementation.batchRemoveRelations>) =>
  backendCall(() => implementation.batchRemoveRelations(commandDependencies(), ...args));
