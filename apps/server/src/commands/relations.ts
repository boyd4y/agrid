import * as implementation from "../business/commands/relations.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const affectedTables = (...args: Arguments<typeof implementation.affectedTables>) =>
  businessCall(() => implementation.affectedTables(commandDependencies(), ...args));
export const createRelationColumn = (...args: Arguments<typeof implementation.createRelationColumn>) =>
  businessCall(() => implementation.createRelationColumn(commandDependencies(), ...args));
export const createRelationColumnInTransaction = (...args: Arguments<typeof implementation.createRelationColumnInTransaction>) =>
  businessCall(() => implementation.createRelationColumnInTransaction(commandDependencies(), ...args));
export const validateRollup = (...args: Arguments<typeof implementation.validateRollup>) =>
  businessCall(() => implementation.validateRollup(commandDependencies(), ...args));
export const assertNoRollupDependency = (...args: Arguments<typeof implementation.assertNoRollupDependency>) =>
  businessCall(() => implementation.assertNoRollupDependency(commandDependencies(), ...args));
export const prepareRelationWrites = (...args: Arguments<typeof implementation.prepareRelationWrites>) =>
  businessCall(() => implementation.prepareRelationWrites(commandDependencies(), ...args));
export const applyRelationWrites = (...args: Arguments<typeof implementation.applyRelationWrites>) =>
  businessCall(() => implementation.applyRelationWrites(commandDependencies(), ...args));
export const queryRelationRecords = (...args: Arguments<typeof implementation.queryRelationRecords>) =>
  businessCall(() => implementation.queryRelationRecords(commandDependencies(), ...args));
export const getRow = (...args: Arguments<typeof implementation.getRow>) =>
  businessCall(() => implementation.getRow(commandDependencies(), ...args));
export { relationConfigSchema } from "../business/commands/relations.js";
export { rollupConfigSchema } from "../business/commands/relations.js";
