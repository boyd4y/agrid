import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { createStorageAdapter, storageConfig, uploadLimits } from "../../src/storage/adapter.js";

const makeKey = () => { const id = randomUUID(); return `${id.slice(0, 2)}/${id}`; };
test("local objects round-trip binary streams and cannot address server paths", async () => {
  const dir = await mkdtemp(`${tmpdir()}/tabdo-storage-local-`);
  const adapter = createStorageAdapter({ driver: "local", localDir: dir });
  const key = makeKey(), bytes = new Uint8Array([0, 10, 255, 13, 127]);
  try {
    await adapter.put(key, bytes, "application/octet-stream");
    assert.deepEqual(new Uint8Array(await new Response(await adapter.open(key)).arrayBuffer()), bytes);
    await assert.rejects(adapter.put(key, bytes, "application/octet-stream"), /EEXIST/);
    for (const bad of ["../../.env", "/etc/passwd", "a/b", `${key}/../.env`]) {
      await assert.rejects(adapter.open(bad), /Invalid object storage key/);
      await assert.rejects(adapter.remove(bad), /Invalid object storage key/);
    }
    await adapter.remove(key); await adapter.remove(key);
    assert.deepEqual(await readdir(`${dir}/${key.slice(0, 2)}`), []);
    await assert.rejects(adapter.open(key), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function awsEncode(value: string) { return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
function verifySignature(request: IncomingMessage, secret: string) {
  const authorization = request.headers.authorization || "";
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]+)$/.exec(authorization);
  assert(match, "official SDK signs requests with SigV4");
  assert.equal(match[1], "storage-fixture");
  const uri = new URL(request.url!, "http://fixture");
  const signedHeaders = match[3].split(";");
  const headers = signedHeaders.map(name => `${name}:${String(request.headers[name]).trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...uri.searchParams.entries()].map(([key, value]) => [awsEncode(key), awsEncode(value)]).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([key, value]) => `${key}=${value}`).join("&");
  const canonical = [request.method, uri.pathname, query, headers, match[3], request.headers["x-amz-content-sha256"]].join("\n");
  const scope = match[2], [date, region, service] = scope.split("/");
  const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
  const toSign = ["AWS4-HMAC-SHA256", request.headers["x-amz-date"], scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  assert.equal(createHmac("sha256", key).update(toSign).digest("hex"), match[4], "fixture validates the actual SDK signature");
}
test("official S3 client signs path-style PUT/GET/DELETE and returns streamed binary objects", async () => {
  const objects = new Map<string, Buffer>(); const operations: string[] = []; const errors: unknown[] = [];
  const fixture = createServer(async (request, response) => {
    try {
      verifySignature(request, "fixture-secret");
      const key = new URL(request.url!, "http://fixture").pathname;
      assert.match(key, /^\/fixture-bucket\/[a-f0-9]{2}\/[a-f0-9-]+$/);
      operations.push(request.method!);
      if (request.method === "PUT") {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        objects.set(key, Buffer.concat(chunks)); response.writeHead(200); response.end();
      } else if (request.method === "GET") {
        const bytes = objects.get(key); assert(bytes);
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(bytes.length) });
        response.write(bytes.subarray(0, 2)); setImmediate(() => response.end(bytes.subarray(2)));
      } else if (request.method === "DELETE") { objects.delete(key); response.writeHead(204); response.end(); }
      else throw new Error("Unexpected fixture operation");
    } catch (error) { errors.push(error); response.writeHead(400); response.end("fixture failure"); }
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address(); assert(address && typeof address !== "string");
  const adapter = createStorageAdapter({ driver: "s3", localDir: "unused", s3: { endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", bucket: "fixture-bucket", accessKeyId: "storage-fixture", secretAccessKey: "fixture-secret", forcePathStyle: true } });
  const key = makeKey(), bytes = new Uint8Array([0, 255, 4, 128, 34]);
  try {
    await adapter.put(key, bytes, "application/octet-stream");
    assert.deepEqual(new Uint8Array(await new Response(await adapter.open(key)).arrayBuffer()), bytes);
    await adapter.remove(key);
    assert.equal(objects.size, 0); assert.deepEqual(operations, ["PUT", "GET", "DELETE"]); assert.deepEqual(errors, []);
  } finally { await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve())); }
});

test("storage configuration bounds uploads and supports paired credentials or the SDK credential chain", () => {
  assert.deepEqual(uploadLimits({}), { maxFileBytes: 25 * 1024 * 1024, maxFiles: 20, maxBodyBytes: 100 * 1024 * 1024 });
  assert.throws(() => uploadLimits({ FILE_UPLOAD_MAX_FILES: "101" }));
  assert.throws(() => uploadLimits({ FILE_UPLOAD_MAX_BYTES: "NaN" }));
  assert.throws(() => storageConfig({ FILE_STORAGE_DRIVER: "other" }));
  assert.throws(() => storageConfig({ FILE_STORAGE_DRIVER: "s3", FILE_STORAGE_S3_BUCKET: "fixture", FILE_STORAGE_S3_ACCESS_KEY_ID: "partial" }));
  assert.equal(storageConfig({ FILE_STORAGE_DRIVER: "s3", FILE_STORAGE_S3_BUCKET: "fixture" }).s3?.accessKeyId, undefined);
});
