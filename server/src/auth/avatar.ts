import { createHash } from "node:crypto";
import { z } from "zod";
import { parseBotAvatar } from "@tabdo/shared";

export const MAX_AVATAR_BYTES = 256 * 1024;

/** Persist only bounded raster uploads; SVG and external fetches are not accepted. */
export const avatarImageSchema = z.string().max(Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 50).refine((value) => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES || bytes.toString("base64") !== match[2]) return false;
  if (match[1] === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}, "头像必须是有效的 PNG、JPEG 或 WebP 图片，且不超过 256 KB").nullable();

export const botAvatarSchema = z.string().max(100).refine((value) => Boolean(parseBotAvatar(value)), "请选择有效的 bot 头像").nullable();

export function memberAvatarUrl(memberId: string, image: string | null) {
  if (!image) return null;
  if (!image.startsWith("data:")) return image;
  const version = createHash("sha256").update(image).digest("hex").slice(0, 16);
  return `/api/members/${memberId}/avatar?v=${version}`;
}
