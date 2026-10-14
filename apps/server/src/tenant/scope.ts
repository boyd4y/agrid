import * as implementation from "@tabdo/backend/tenant/scope";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const requireTableInOrg = (...args: Arguments<typeof implementation.requireTableInOrg>) =>
  backendCall(() => implementation.requireTableInOrg(commandDependencies(), ...args));
export const requireRowInOrg = (...args: Arguments<typeof implementation.requireRowInOrg>) =>
  backendCall(() => implementation.requireRowInOrg(commandDependencies(), ...args));
export const requireColumnInOrg = (...args: Arguments<typeof implementation.requireColumnInOrg>) =>
  backendCall(() => implementation.requireColumnInOrg(commandDependencies(), ...args));
export const listTablesForOrg = (...args: Arguments<typeof implementation.listTablesForOrg>) =>
  backendCall(() => implementation.listTablesForOrg(commandDependencies(), ...args));
export const tableBelongsToOrg = (...args: Arguments<typeof implementation.tableBelongsToOrg>) =>
  backendCall(() => implementation.tableBelongsToOrg(commandDependencies(), ...args));
export { requireOrgId } from "@tabdo/backend/tenant/scope";
export type { TenantScope } from "@tabdo/backend/tenant/scope";
