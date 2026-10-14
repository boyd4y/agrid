import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { assertObjectKey, type ObjectStorage } from "@tabdo/core";

export type StorageDriver = "local" | "s3";
export type StorageAdapter = ObjectStorage & { readonly driver: StorageDriver };
export type StorageConfig = {
  driver: StorageDriver;
  localDir: string;
  s3?: { endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
};

export function createStorageAdapter(config: StorageConfig): StorageAdapter {
  if (config.driver === "local") {
    const objectPath = (key: string) => { assertObjectKey(key); return path.join(config.localDir, key); };
    return {
      driver: "local",
      async put(key, bytes) { const target = objectPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); },
      async open(key) { const handle = await open(objectPath(key), "r"); return Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>; },
      async remove(key) { await unlink(objectPath(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); },
    };
  }
  if (config.driver !== "s3" || !config.s3) throw new Error("Missing S3 configuration");
  const { bucket, ...settings } = config.s3;
  const client = new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: settings.forcePathStyle, credentials: settings.accessKeyId && settings.secretAccessKey ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } : undefined, maxAttempts: 3 });
  return {
    driver: "s3",
    async put(key, bytes, mimeType) { assertObjectKey(key); await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType })); },
    async open(key) { assertObjectKey(key); const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); if (!object.Body) throw new Error("S3 object has no body"); return object.Body.transformToWebStream(); },
    async remove(key) { assertObjectKey(key); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}
