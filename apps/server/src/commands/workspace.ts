import * as implementation from "@tabdo/backend/commands/workspace";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const getWorkspace = (...args: Arguments<typeof implementation.getWorkspace>) =>
  backendCall(() => implementation.getWorkspace(commandDependencies(), ...args));
export const listMembers = (...args: Arguments<typeof implementation.listMembers>) =>
  backendCall(() => implementation.listMembers(commandDependencies(), ...args));
