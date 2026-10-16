import type { ObjectStorage } from "@tabdo/storage";
export type SiteCapabilities = Readonly<{
  publicOrigin: string; apiOrigin: string; appOrigin: string; sdkUrl: string;
  storageDriver: string;
  storage(driver: string): ObjectStorage;
}>;
