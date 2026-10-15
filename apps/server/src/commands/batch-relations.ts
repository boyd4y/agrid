import * as implementation from "../business/commands/batch-relations.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const batchSetRelations = (...args: Arguments<typeof implementation.batchSetRelations>) =>
  businessCall(() => implementation.batchSetRelations(commandDependencies(), ...args));
export const batchAddRelations = (...args: Arguments<typeof implementation.batchAddRelations>) =>
  businessCall(() => implementation.batchAddRelations(commandDependencies(), ...args));
export const batchRemoveRelations = (...args: Arguments<typeof implementation.batchRemoveRelations>) =>
  businessCall(() => implementation.batchRemoveRelations(commandDependencies(), ...args));
