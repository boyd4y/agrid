import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { assertObjectKey, type ObjectStorage } from "../index.js";

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
};

export function createS3Storage(config: S3StorageConfig): ObjectStorage {
  const { bucket, ...settings } = config;
  const client = new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: settings.forcePathStyle, credentials: settings.accessKeyId && settings.secretAccessKey ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } : undefined, maxAttempts: 3 });
  return {
    async put(key, bytes, mimeType) { assertObjectKey(key); await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType })); },
    async open(key) { assertObjectKey(key); const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); if (!object.Body) throw new Error("S3 object has no body"); return object.Body.transformToWebStream(); },
    async remove(key) { assertObjectKey(key); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}
