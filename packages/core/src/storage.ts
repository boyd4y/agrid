/** Byte storage only. Authorization and file metadata stay in platform services. */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  open(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}

const keyPattern = /^[a-f0-9]{2}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Enforce the same object namespace across filesystem, S3 and R2. */
export function assertObjectKey(key: string): void {
  if (!keyPattern.test(key)) throw new Error("Invalid object storage key");
}
