import * as implementation from "@tabdo/backend/commands/relation-reads";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const readRow = (...args: Arguments<typeof implementation.readRow>) =>
  backendCall(() => implementation.readRow(commandDependencies(), ...args));
export { relationPredicate, relatedId, recordTitle, rollupExpression, cellExpression, rowProjection } from "@tabdo/backend/commands/relation-reads";
