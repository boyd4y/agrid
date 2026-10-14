import * as implementation from "@tabdo/backend/commands/columns";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const addColumn = (...args: Arguments<typeof implementation.addColumn>) =>
  backendCall(() => implementation.addColumn(commandDependencies(), ...args));
export const deleteColumn = (...args: Arguments<typeof implementation.deleteColumn>) =>
  backendCall(() => implementation.deleteColumn(commandDependencies(), ...args));
export const updateColumn = (...args: Arguments<typeof implementation.updateColumn>) =>
  backendCall(() => implementation.updateColumn(commandDependencies(), ...args));
export const batchAddColumns = (...args: Arguments<typeof implementation.batchAddColumns>) =>
  backendCall(() => implementation.batchAddColumns(commandDependencies(), ...args));
export const batchUpdateColumns = (...args: Arguments<typeof implementation.batchUpdateColumns>) =>
  backendCall(() => implementation.batchUpdateColumns(commandDependencies(), ...args));
export const batchDeleteColumns = (...args: Arguments<typeof implementation.batchDeleteColumns>) =>
  backendCall(() => implementation.batchDeleteColumns(commandDependencies(), ...args));
