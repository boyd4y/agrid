import { z } from "zod";
import { parseBotAvatar } from "@tabdo/shared";
export const MAX_AVATAR_BYTES = 256 * 1024;
export const avatarImageSchema = z.string().max(Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 50).refine(value => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  let raw: string;
  try { raw = atob(match[2]); } catch { return false; }
  if (!raw.length || raw.length > MAX_AVATAR_BYTES || btoa(raw) !== match[2]) return false;
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (match[1] === "png") return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  if (match[1] === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return raw.slice(0, 4) === "RIFF" && raw.slice(8, 12) === "WEBP";
}, "头像必须是有效的 PNG、JPEG 或 WebP 图片，且不超过 256 KB").nullable();
export const botAvatarSchema = z.string().max(100).refine(value => Boolean(parseBotAvatar(value)), "请选择有效的 bot 头像").nullable();
