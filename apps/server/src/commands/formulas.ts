import * as implementation from "@tabdo/backend/commands/formulas";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const loadTableColumns = (...args: Arguments<typeof implementation.loadTableColumns>) =>
  backendCall(() => implementation.loadTableColumns(commandDependencies(), ...args));
export const persistRowWithFormulas = (...args: Arguments<typeof implementation.persistRowWithFormulas>) =>
  backendCall(() => implementation.persistRowWithFormulas(commandDependencies(), ...args));
export const recomputeAllFormulasForTable = (...args: Arguments<typeof implementation.recomputeAllFormulasForTable>) =>
  backendCall(() => implementation.recomputeAllFormulasForTable(commandDependencies(), ...args));
export const recomputeFormulasInTransaction = (...args: Arguments<typeof implementation.recomputeFormulasInTransaction>) =>
  backendCall(() => implementation.recomputeFormulasInTransaction(commandDependencies(), ...args));
export { applyFormulasToCells, assertFormulaConfig } from "@tabdo/backend/commands/formulas";
