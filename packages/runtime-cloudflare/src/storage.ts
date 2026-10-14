import { assertObjectKey, type ObjectStorage } from "@tabdo/core";

export function createR2Storage(bucket: R2Bucket): ObjectStorage {
  return Object.freeze({
    async put(key: string, bytes: Uint8Array, mimeType: string) {
      assertObjectKey(key);
      await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    },
    async open(key: string) {
      assertObjectKey(key);
      const object = await bucket.get(key);
      if (!object) throw new Error("Object not found");
      // CF's declared stream type differs from DOM's. Bridge with backpressure,
      // without a type cast or buffering the whole object into memory.
      const reader = object.body.getReader();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) { reader.releaseLock(); controller.close(); }
            else if (result.value instanceof Uint8Array) controller.enqueue(result.value);
            else throw new Error("Invalid object byte stream");
          } catch (error) { reader.releaseLock(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
      });
    },
    async remove(key: string) {
      assertObjectKey(key);
      await bucket.delete(key);
    },
  });
}
