import { readFileSync } from "node:fs";
import { getStorageAdapter, storageConfig, type StorageDriver } from "../storage/adapter.js";
import type { SiteCapabilities } from "../business/sites/dependencies.js";
let sdk: string | undefined;
export function siteCapabilities(): SiteCapabilities {
  sdk ??= readFileSync(new URL("../../../../packages/sdk/dist/tabdo.js", import.meta.url), "utf8");
  const apiOrigin = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3001").origin;
  return { apiOrigin, appOrigin: new URL(process.env.APP_URL || "http://localhost:5173").origin,
    publicOrigin: new URL(process.env.SITE_PUBLIC_ORIGIN || apiOrigin).origin, sdk,
    storageDriver: storageConfig().driver, storage: driver => getStorageAdapter(driver as StorageDriver) };
}
