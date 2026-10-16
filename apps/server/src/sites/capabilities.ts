import { getStorageAdapter, storageConfig, type StorageDriver } from "../storage/adapter.js";
import type { SiteCapabilities } from "../business/sites/dependencies.js";

type SiteEnvironment = Readonly<Record<string, string | undefined>>;
export function siteSdkUrl(env: SiteEnvironment = process.env): string {
  const value = env.SITE_SDK_URL || "https://cdn.jsdelivr.net/npm/@tabdo/sdk@0.1.1/dist/tabdo.js";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SITE_SDK_URL must be an absolute HTTPS module URL"); }
  const local = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.username || url.password || url.hash) {
    throw new Error("SITE_SDK_URL must be an absolute HTTPS module URL without credentials or a fragment");
  }
  return url.href;
}
export function siteCapabilities(env: SiteEnvironment = process.env): SiteCapabilities {
  const apiOrigin = new URL(env.BETTER_AUTH_URL || "http://localhost:3001").origin;
  return { apiOrigin, appOrigin: new URL(env.APP_URL || "http://localhost:5173").origin,
    publicOrigin: new URL(env.SITE_PUBLIC_ORIGIN || apiOrigin).origin, sdkUrl: siteSdkUrl(env),
    storageDriver: storageConfig().driver, storage: driver => getStorageAdapter(driver as StorageDriver) };
}
