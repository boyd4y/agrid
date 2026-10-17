import * as implementation from "../business/commands/workspace.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const getWorkspace = (...args: Arguments<typeof implementation.getWorkspace>) =>
  businessCall(() => implementation.getWorkspace(commandDependencies(), ...args));
export const listMembers = (...args: Arguments<typeof implementation.listMembers>) =>
  businessCall(() => implementation.listMembers(commandDependencies(), ...args));
export const listWorkspaces = (...args: Arguments<typeof implementation.listWorkspaces>) =>
  businessCall(() => implementation.listWorkspaces(commandDependencies(), ...args));
export const createWorkspace = (...args: Arguments<typeof implementation.createWorkspace>) =>
  businessCall(() => implementation.createWorkspace(commandDependencies(), ...args));
