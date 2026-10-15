import * as implementation from "../business/automation/events.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const appendAutomationEvent = (...args: Arguments<typeof implementation.appendAutomationEvent>) =>
  businessCall(() => implementation.appendAutomationEvent(commandDependencies(), ...args));
export const appendExternalAutomationEvent = (...args: Arguments<typeof implementation.appendExternalAutomationEvent>) =>
  businessCall(() => implementation.appendExternalAutomationEvent(commandDependencies(), ...args));
export { eventBindingContext, eventConditionsMatch } from "../business/automation/events.js";
export type { EventSnapshot, ExternalAutomationEvent, ExternalEventSnapshot, AnyEventSnapshot } from "../business/automation/events.js";
