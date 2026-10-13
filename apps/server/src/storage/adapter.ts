import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export type StorageDriver = "local" | "s3";
export type StorageAdapter = {
  driver: StorageDriver;
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  open(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
};
export type StorageConfig = {
  driver: StorageDriver;
  localDir: string;
  s3?: { endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
};
const defaultLocalDir = fileURLToPath(new URL("../../../../data/files", import.meta.url));
const keyPattern = /^[a-f0-9]{2}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function assertKey(key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid object storage key");
}
function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`Invalid ${name}`);
  return result;
}
export function uploadLimits(env: NodeJS.ProcessEnv = process.env) {
  const maxFileBytes = positiveInteger(env.FILE_UPLOAD_MAX_BYTES, 25 * 1024 * 1024, "FILE_UPLOAD_MAX_BYTES");
  const maxFiles = positiveInteger(env.FILE_UPLOAD_MAX_FILES, 20, "FILE_UPLOAD_MAX_FILES");
  const maxBodyBytes = positiveInteger(env.FILE_UPLOAD_MAX_REQUEST_BYTES, 100 * 1024 * 1024, "FILE_UPLOAD_MAX_REQUEST_BYTES");
  if (maxFiles > 100) throw new Error("FILE_UPLOAD_MAX_FILES must not exceed 100");
  if (maxFileBytes > 2_147_483_647) throw new Error("FILE_UPLOAD_MAX_BYTES exceeds metadata size capacity");
  return { maxFileBytes, maxFiles, maxBodyBytes };
}
export function storageConfig(env: NodeJS.ProcessEnv = process.env, driver = env.FILE_STORAGE_DRIVER || "local"): StorageConfig {
  if (driver !== "local" && driver !== "s3") throw new Error("FILE_STORAGE_DRIVER must be local or s3");
  const config: StorageConfig = { driver, localDir: path.resolve(env.FILE_STORAGE_LOCAL_DIR || defaultLocalDir) };
  if (driver === "s3") {
    if (!env.FILE_STORAGE_S3_BUCKET) throw new Error("S3 file storage requires a bucket");
    if (Boolean(env.FILE_STORAGE_S3_ACCESS_KEY_ID) !== Boolean(env.FILE_STORAGE_S3_SECRET_ACCESS_KEY)) throw new Error("S3 access key and secret key must be configured together");
    if (env.FILE_STORAGE_S3_ENDPOINT) {
      const endpoint = new URL(env.FILE_STORAGE_S3_ENDPOINT);
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("Invalid FILE_STORAGE_S3_ENDPOINT");
    }
    if (env.FILE_STORAGE_S3_FORCE_PATH_STYLE && !["true", "false"].includes(env.FILE_STORAGE_S3_FORCE_PATH_STYLE)) throw new Error("FILE_STORAGE_S3_FORCE_PATH_STYLE must be true or false");
    config.s3 = { endpoint: env.FILE_STORAGE_S3_ENDPOINT || undefined, region: env.FILE_STORAGE_S3_REGION || "us-east-1", bucket: env.FILE_STORAGE_S3_BUCKET, accessKeyId: env.FILE_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: env.FILE_STORAGE_S3_SECRET_ACCESS_KEY, forcePathStyle: env.FILE_STORAGE_S3_FORCE_PATH_STYLE !== "false" };
  }
  return config;
}
export function createStorageAdapter(config: StorageConfig): StorageAdapter {
  if (config.driver === "local") {
    const objectPath = (key: string) => { assertKey(key); return path.join(config.localDir, key); };
    return {
      driver: "local",
      async put(key, bytes) { const target = objectPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); },
      async open(key) { const handle = await open(objectPath(key), "r"); return Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>; },
      async remove(key) { await unlink(objectPath(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); },
    };
  }
  if (!config.s3) throw new Error("Missing S3 configuration");
  const { bucket, ...settings } = config.s3;
  const client = new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: settings.forcePathStyle, credentials: settings.accessKeyId && settings.secretAccessKey ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } : undefined, maxAttempts: 3 });
  return {
    driver: "s3",
    async put(key, bytes, mimeType) { assertKey(key); await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType })); },
    async open(key) { assertKey(key); const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); if (!object.Body) throw new Error("S3 object has no body"); return object.Body.transformToWebStream(); },
    async remove(key) { assertKey(key); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}
// Retain old driver configuration for objects created before a driver switch.
const adapters = new Map<string, StorageAdapter>();
export function getStorageAdapter(driver?: StorageDriver): StorageAdapter {
  const config = storageConfig(process.env, driver);
  const identity = JSON.stringify(config);
  let adapter = adapters.get(identity);
  if (!adapter) { adapter = createStorageAdapter(config); adapters.set(identity, adapter); }
  return adapter;
}
