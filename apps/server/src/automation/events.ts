import * as implementation from "@tabdo/backend/automation/events";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const appendAutomationEvent = (...args: Arguments<typeof implementation.appendAutomationEvent>) =>
  backendCall(() => implementation.appendAutomationEvent(commandDependencies(), ...args));
export const appendExternalAutomationEvent = (...args: Arguments<typeof implementation.appendExternalAutomationEvent>) =>
  backendCall(() => implementation.appendExternalAutomationEvent(commandDependencies(), ...args));
export { eventBindingContext, eventConditionsMatch } from "@tabdo/backend/automation/events";
export type { EventSnapshot, ExternalAutomationEvent, ExternalEventSnapshot, AnyEventSnapshot } from "@tabdo/backend/automation/events";
