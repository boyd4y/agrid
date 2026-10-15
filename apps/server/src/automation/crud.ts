import * as implementation from "../business/automation/crud.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const listWorkspaceAutomations = (...args: Arguments<typeof implementation.listWorkspaceAutomations>) =>
  businessCall(() => implementation.listWorkspaceAutomations(commandDependencies(), ...args));
export const getWorkspaceAutomation = (...args: Arguments<typeof implementation.getWorkspaceAutomation>) =>
  businessCall(() => implementation.getWorkspaceAutomation(commandDependencies(), ...args));
export const listAutomations = (...args: Arguments<typeof implementation.listAutomations>) =>
  businessCall(() => implementation.listAutomations(commandDependencies(), ...args));
export const createAutomation = (...args: Arguments<typeof implementation.createAutomation>) =>
  businessCall(() => implementation.createAutomation(commandDependencies(), ...args));
export const updateAutomation = (...args: Arguments<typeof implementation.updateAutomation>) =>
  businessCall(() => implementation.updateAutomation(commandDependencies(), ...args));
export const deleteAutomation = (...args: Arguments<typeof implementation.deleteAutomation>) =>
  businessCall(() => implementation.deleteAutomation(commandDependencies(), ...args));
export const listRuleRuns = (...args: Arguments<typeof implementation.listRuleRuns>) =>
  businessCall(() => implementation.listRuleRuns(commandDependencies(), ...args));
export const listAutomationRuns = (...args: Arguments<typeof implementation.listAutomationRuns>) =>
  businessCall(() => implementation.listAutomationRuns(commandDependencies(), ...args));
export const getEnabledAutomations = (...args: Arguments<typeof implementation.getEnabledAutomations>) =>
  businessCall(() => implementation.getEnabledAutomations(commandDependencies(), ...args));
export const replayAutomationRun = (...args: Arguments<typeof implementation.replayAutomationRun>) =>
  businessCall(() => implementation.replayAutomationRun(commandDependencies(), ...args));
export { mapRule } from "../business/automation/crud.js";
