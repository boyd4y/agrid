import * as implementation from "../business/commands/columns.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const addColumn = (...args: Arguments<typeof implementation.addColumn>) =>
  businessCall(() => implementation.addColumn(commandDependencies(), ...args));
export const deleteColumn = (...args: Arguments<typeof implementation.deleteColumn>) =>
  businessCall(() => implementation.deleteColumn(commandDependencies(), ...args));
export const updateColumn = (...args: Arguments<typeof implementation.updateColumn>) =>
  businessCall(() => implementation.updateColumn(commandDependencies(), ...args));
export const batchAddColumns = (...args: Arguments<typeof implementation.batchAddColumns>) =>
  businessCall(() => implementation.batchAddColumns(commandDependencies(), ...args));
export const batchUpdateColumns = (...args: Arguments<typeof implementation.batchUpdateColumns>) =>
  businessCall(() => implementation.batchUpdateColumns(commandDependencies(), ...args));
export const batchDeleteColumns = (...args: Arguments<typeof implementation.batchDeleteColumns>) =>
  businessCall(() => implementation.batchDeleteColumns(commandDependencies(), ...args));
