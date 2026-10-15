import { sha256 } from "../auth/hash.js";
import { ServiceError } from "../errors.js";
import type { IntegrationCapabilities } from "./dependencies.js";
export type SecretContext = { organizationId: string; id: string; purpose: "agentmail-key" | "agentmail-signing" };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function key(deps: Pick<IntegrationCapabilities, "encryptionKey">) {
  const raw = deps.encryptionKey.trim();
  let bytes: Uint8Array;
  try { bytes = /^[a-f0-9]{64}$/i.test(raw) ? Uint8Array.from(raw.match(/../g)!, byte => parseInt(byte, 16)) : decode(raw); }
  catch { bytes = new Uint8Array(); }
  if (!raw || bytes.length !== 32 || (!/^[a-f0-9]{64}$/i.test(raw) && encode(bytes) !== raw)) throw new ServiceError(503, { message: "集成加密密钥未配置：请设置32字节 INTEGRATION_ENCRYPTION_KEY" });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const keyId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return { key: await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]), keyId };
}
const aad = (context: SecretContext) => new TextEncoder().encode(JSON.stringify(["tabdo-integrations-v1", context.organizationId, context.id, context.purpose]));
/** Same versioned AES-256-GCM envelope as Node deployments; no credential migration. */
export async function encryptSecret(deps: Pick<IntegrationCapabilities, "encryptionKey">, secret: string, context: SecretContext): Promise<Record<string, string>> {
  const encryptionKey = await key(deps), nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(context), tagLength: 128 }, encryptionKey.key, new TextEncoder().encode(secret)));
  return { version: "1", keyId: encryptionKey.keyId, nonce: encode(nonce), ciphertext: encode(encrypted.subarray(0, -16)), tag: encode(encrypted.subarray(-16)) };
}
export async function decryptSecret(deps: Pick<IntegrationCapabilities, "encryptionKey">, envelope: Record<string, string>, context: SecretContext): Promise<string> {
  const encryptionKey = await key(deps);
  try {
    if (envelope.version !== "1" || envelope.keyId !== encryptionKey.keyId) throw new Error("key mismatch");
    const ciphertext = decode(envelope.ciphertext), tag = decode(envelope.tag), joined = new Uint8Array(ciphertext.length + tag.length);
    joined.set(ciphertext); joined.set(tag, ciphertext.length);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.nonce), additionalData: aad(context), tagLength: 128 }, encryptionKey.key, joined));
  } catch { throw new ServiceError(503, { message: "集成凭证无法解密，请检查部署密钥或重新设置凭证" }); }
}
export function secretToken(prefix: string) {
  return prefix + encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
/** Compare fixed length digests through WebCrypto's native HMAC verification. */
export async function verifyToken(raw: string, expectedHash: string | null): Promise<boolean> {
  if (!raw || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(await sha256(raw)));
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(expectedHash));
}
