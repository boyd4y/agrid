export class InternalAuthenticationError extends Error {
  constructor(message: string, readonly status: 400 | 401) { super(message);this.name = "InternalAuthenticationError"; }
}

const version = "tabdo-internal-v1";
const signatureHeader = "x-tabdo-internal-signature";
const timeHeader = "x-tabdo-internal-issued-at";
const idHeader = "x-tabdo-internal-request-id";

export type InternalAuthenticationOptions = Readonly<{
  secret: string;
  audience: string;
  now?: number;
  maxAgeMs?: number;
  maxBytes?: number;
}>;

export type VerifiedInternalRequest = Readonly<{ requestId: string; issuedAt: number; body: string }>;

function config(options: InternalAuthenticationOptions) {
  if (options.secret.length < 32 || !options.audience || options.audience.length > 128) throw new Error("Invalid internal authentication configuration");
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 60000;
  const maxBytes = options.maxBytes ?? 16384;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw new Error("Invalid internal authentication bounds");
  return { now, maxAgeMs, maxBytes };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signatureInput(request: Request, audience: string, issuedAt: number, requestId: string, bytes: Uint8Array): Promise<Uint8Array> {
  const url = new URL(request.url);
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  return new TextEncoder().encode(JSON.stringify([version, audience, request.method, url.pathname + url.search, issuedAt, requestId, digest]));
}

async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        // A signing clone is a tee branch: awaiting cancellation would wait
        // for the untouched original body and deadlock oversized requests.
        void reader.cancel().catch(() => {});
        throw new InternalAuthenticationError("Internal request rejected", 400);
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return body;
}

/** Sign only small control references. Never include DB credentials or caller principal in the body. */
export async function signInternalRequest(request: Request, options: InternalAuthenticationOptions & Readonly<{ requestId: string }>): Promise<Request> {
  const { now, maxBytes } = config(options);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.requestId)) throw new Error("Invalid internal request id");
  const bytes = await boundedBody(request.clone(), maxBytes);
  const signature = hex(await crypto.subtle.sign("HMAC", await key(options.secret), await signatureInput(request, options.audience, now, options.requestId, bytes)));
  const signed = new Request(request);
  signed.headers.set(timeHeader, String(now));
  signed.headers.set(idHeader, options.requestId);
  signed.headers.set(signatureHeader, signature);
  return signed;
}

/** Authentication is not replay protection. Atomically claim requestId with acceptance in the platform. */
export async function verifyInternalRequest(request: Request, options: InternalAuthenticationOptions): Promise<VerifiedInternalRequest> {
  const { now, maxAgeMs, maxBytes } = config(options);
  const rawTime = request.headers.get(timeHeader) ?? "";
  const requestId = request.headers.get(idHeader) ?? "";
  const signature = request.headers.get(signatureHeader) ?? "";
  const issuedAt = Number(rawTime);
  if (!/^\d+$/.test(rawTime) || !Number.isSafeInteger(issuedAt) || Math.abs(now-issuedAt) > maxAgeMs || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new InternalAuthenticationError("Internal authentication failed", 401);
  }
  const bytes = await boundedBody(request, maxBytes);
  const decoded = new Uint8Array(signature.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
  // Web Crypto performs MAC verification without a secret-dependent string comparison.
  const valid = await crypto.subtle.verify("HMAC", await key(options.secret), decoded, await signatureInput(request, options.audience, issuedAt, requestId, bytes));
  if (!valid) throw new InternalAuthenticationError("Internal authentication failed", 401);
  let body: string;
  try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new InternalAuthenticationError("Internal request rejected", 400); }
  return Object.freeze({ requestId, issuedAt, body });
}
