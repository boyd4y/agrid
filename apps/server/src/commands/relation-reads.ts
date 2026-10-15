import * as implementation from "../business/commands/relation-reads.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const readRow = (...args: Arguments<typeof implementation.readRow>) =>
  businessCall(() => implementation.readRow(commandDependencies(), ...args));
export { relationPredicate, relatedId, recordTitle, rollupExpression, cellExpression, rowProjection } from "../business/commands/relation-reads.js";
