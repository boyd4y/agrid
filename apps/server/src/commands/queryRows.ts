import * as implementation from "../business/commands/queryRows.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const queryRowsWindowed = (...args: Arguments<typeof implementation.queryRowsWindowed>) =>
  businessCall(() => implementation.queryRowsWindowed(commandDependencies(), ...args));
export const countTableRows = (...args: Arguments<typeof implementation.countTableRows>) =>
  businessCall(() => implementation.countTableRows(commandDependencies(), ...args));
