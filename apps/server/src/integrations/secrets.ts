import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";

export type SecretContext = { organizationId: string; id: string; purpose: "agentmail-key" | "agentmail-signing" };
function key() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ?? "";
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (!raw || bytes.length !== 32 || (!/^[a-f0-9]{64}$/i.test(raw) && bytes.toString("base64") !== raw)) {
    throw new HTTPException(503, { message: "集成加密密钥未配置：请设置32字节 INTEGRATION_ENCRYPTION_KEY" });
  }
  return bytes;
}
function aad(context: SecretContext) { return Buffer.from(JSON.stringify(["tabdo-integrations-v1", context.organizationId, context.id, context.purpose])); }
export function encryptSecret(secret: string, context: SecretContext): Record<string, string> {
  const encryptionKey = key(), nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce); cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { version: "1", keyId: createHash("sha256").update(encryptionKey).digest("hex").slice(0, 16),
    nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptSecret(envelope: Record<string, string>, context: SecretContext): string {
  const encryptionKey = key();
  try {
    if (envelope.version !== "1" || envelope.keyId !== createHash("sha256").update(encryptionKey).digest("hex").slice(0, 16)) throw new Error("key mismatch");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(envelope.nonce, "base64"));
    decipher.setAAD(aad(context)); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new HTTPException(503, { message: "集成凭证无法解密，请检查部署密钥或重新设置凭证" }); }
}
