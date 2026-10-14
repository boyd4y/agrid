/** Byte storage only. Authorization, business metadata and lifecycle belong above this interface. */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  open(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}

/** Portable relative keys. No table IDs, UUID layout or file-field conventions. */
export function assertObjectKey(key: string): void {
  if (!key || /[\\\u0000-\u001f]/.test(key) || key.includes(":")
    || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid object storage key");
  }
}
