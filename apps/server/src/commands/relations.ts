import * as implementation from "@tabdo/backend/commands/relations";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const affectedTables = (...args: Arguments<typeof implementation.affectedTables>) =>
  backendCall(() => implementation.affectedTables(commandDependencies(), ...args));
export const createRelationColumn = (...args: Arguments<typeof implementation.createRelationColumn>) =>
  backendCall(() => implementation.createRelationColumn(commandDependencies(), ...args));
export const createRelationColumnInTransaction = (...args: Arguments<typeof implementation.createRelationColumnInTransaction>) =>
  backendCall(() => implementation.createRelationColumnInTransaction(commandDependencies(), ...args));
export const validateRollup = (...args: Arguments<typeof implementation.validateRollup>) =>
  backendCall(() => implementation.validateRollup(commandDependencies(), ...args));
export const assertNoRollupDependency = (...args: Arguments<typeof implementation.assertNoRollupDependency>) =>
  backendCall(() => implementation.assertNoRollupDependency(commandDependencies(), ...args));
export const prepareRelationWrites = (...args: Arguments<typeof implementation.prepareRelationWrites>) =>
  backendCall(() => implementation.prepareRelationWrites(commandDependencies(), ...args));
export const applyRelationWrites = (...args: Arguments<typeof implementation.applyRelationWrites>) =>
  backendCall(() => implementation.applyRelationWrites(commandDependencies(), ...args));
export const queryRelationRecords = (...args: Arguments<typeof implementation.queryRelationRecords>) =>
  backendCall(() => implementation.queryRelationRecords(commandDependencies(), ...args));
export const getRow = (...args: Arguments<typeof implementation.getRow>) =>
  backendCall(() => implementation.getRow(commandDependencies(), ...args));
export { relationConfigSchema } from "@tabdo/backend/commands/relations";
export { rollupConfigSchema } from "@tabdo/backend/commands/relations";
