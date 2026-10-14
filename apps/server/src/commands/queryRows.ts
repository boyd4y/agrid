import * as implementation from "@tabdo/backend/commands/queryRows";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const queryRowsWindowed = (...args: Arguments<typeof implementation.queryRowsWindowed>) =>
  backendCall(() => implementation.queryRowsWindowed(commandDependencies(), ...args));
export const countTableRows = (...args: Arguments<typeof implementation.countTableRows>) =>
  backendCall(() => implementation.countTableRows(commandDependencies(), ...args));
