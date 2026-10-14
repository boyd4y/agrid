import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertObjectKey, type ObjectStorage } from "@tabdo/core/storage";

export function createLocalStorage(directory: string): ObjectStorage {
  const objectPath = (key: string) => { assertObjectKey(key); return path.join(directory, key); };
  return {
    async put(key, bytes) { const target = objectPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); },
    async open(key) { const handle = await open(objectPath(key), "r"); return Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>; },
    async remove(key) { await unlink(objectPath(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); },
  };
}
