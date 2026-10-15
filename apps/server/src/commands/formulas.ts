import * as implementation from "../business/commands/formulas.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const loadTableColumns = (...args: Arguments<typeof implementation.loadTableColumns>) =>
  businessCall(() => implementation.loadTableColumns(commandDependencies(), ...args));
export const persistRowWithFormulas = (...args: Arguments<typeof implementation.persistRowWithFormulas>) =>
  businessCall(() => implementation.persistRowWithFormulas(commandDependencies(), ...args));
export const recomputeAllFormulasForTable = (...args: Arguments<typeof implementation.recomputeAllFormulasForTable>) =>
  businessCall(() => implementation.recomputeAllFormulasForTable(commandDependencies(), ...args));
export const recomputeFormulasInTransaction = (...args: Arguments<typeof implementation.recomputeFormulasInTransaction>) =>
  businessCall(() => implementation.recomputeFormulasInTransaction(commandDependencies(), ...args));
export { applyFormulasToCells, assertFormulaConfig } from "../business/commands/formulas.js";
