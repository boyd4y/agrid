import { createHash } from "node:crypto";
export { MAX_AVATAR_BYTES, avatarImageSchema, botAvatarSchema } from "../business/auth/avatar-validation.js";

export function memberAvatarUrl(memberId: string, image: string | null) {
  if (!image) return null;
  if (!image.startsWith("data:")) return image;
  const version = createHash("sha256").update(image).digest("hex").slice(0, 16);
  return `/api/members/${memberId}/avatar?v=${version}`;
}
