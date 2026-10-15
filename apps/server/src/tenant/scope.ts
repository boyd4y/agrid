import * as implementation from "../business/tenant/scope.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const requireTableInOrg = (...args: Arguments<typeof implementation.requireTableInOrg>) =>
  businessCall(() => implementation.requireTableInOrg(commandDependencies(), ...args));
export const requireRowInOrg = (...args: Arguments<typeof implementation.requireRowInOrg>) =>
  businessCall(() => implementation.requireRowInOrg(commandDependencies(), ...args));
export const requireColumnInOrg = (...args: Arguments<typeof implementation.requireColumnInOrg>) =>
  businessCall(() => implementation.requireColumnInOrg(commandDependencies(), ...args));
export const listTablesForOrg = (...args: Arguments<typeof implementation.listTablesForOrg>) =>
  businessCall(() => implementation.listTablesForOrg(commandDependencies(), ...args));
export const tableBelongsToOrg = (...args: Arguments<typeof implementation.tableBelongsToOrg>) =>
  businessCall(() => implementation.tableBelongsToOrg(commandDependencies(), ...args));
export { requireOrgId } from "../business/tenant/scope.js";
export type { TenantScope } from "../business/tenant/scope.js";
