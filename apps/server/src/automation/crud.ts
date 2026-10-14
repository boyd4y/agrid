import * as implementation from "@tabdo/backend/automation/crud";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const listWorkspaceAutomations = (...args: Arguments<typeof implementation.listWorkspaceAutomations>) =>
  backendCall(() => implementation.listWorkspaceAutomations(commandDependencies(), ...args));
export const getWorkspaceAutomation = (...args: Arguments<typeof implementation.getWorkspaceAutomation>) =>
  backendCall(() => implementation.getWorkspaceAutomation(commandDependencies(), ...args));
export const listAutomations = (...args: Arguments<typeof implementation.listAutomations>) =>
  backendCall(() => implementation.listAutomations(commandDependencies(), ...args));
export const createAutomation = (...args: Arguments<typeof implementation.createAutomation>) =>
  backendCall(() => implementation.createAutomation(commandDependencies(), ...args));
export const updateAutomation = (...args: Arguments<typeof implementation.updateAutomation>) =>
  backendCall(() => implementation.updateAutomation(commandDependencies(), ...args));
export const deleteAutomation = (...args: Arguments<typeof implementation.deleteAutomation>) =>
  backendCall(() => implementation.deleteAutomation(commandDependencies(), ...args));
export const listRuleRuns = (...args: Arguments<typeof implementation.listRuleRuns>) =>
  backendCall(() => implementation.listRuleRuns(commandDependencies(), ...args));
export const listAutomationRuns = (...args: Arguments<typeof implementation.listAutomationRuns>) =>
  backendCall(() => implementation.listAutomationRuns(commandDependencies(), ...args));
export const getEnabledAutomations = (...args: Arguments<typeof implementation.getEnabledAutomations>) =>
  backendCall(() => implementation.getEnabledAutomations(commandDependencies(), ...args));
export const replayAutomationRun = (...args: Arguments<typeof implementation.replayAutomationRun>) =>
  backendCall(() => implementation.replayAutomationRun(commandDependencies(), ...args));
export { mapRule } from "@tabdo/backend/automation/crud";
