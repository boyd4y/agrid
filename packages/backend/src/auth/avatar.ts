import { sha256 } from "./hash.js";

/** Public image projection only; embedded uploads are read through the authenticated member endpoint. */
export async function memberAvatarUrl(memberId: string, image: string | null): Promise<string | null> {
  if (!image) return null;
  if (!image.startsWith("data:")) return image;
  const version = (await sha256(image)).slice(0, 16);
  return `/api/members/${memberId}/avatar?v=${version}`;
}
