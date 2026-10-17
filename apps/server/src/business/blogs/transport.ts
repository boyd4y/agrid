import { BLOG_COMMANDS, BLOG_READ_COMMANDS, type BlogCommand } from "@tabdo/shared";
import { BlogError } from "./errors.js";
export const isBlogCommand = (name: string): name is BlogCommand => (BLOG_COMMANDS as string[]).includes(name);
export function blogTransportInput(command: BlogCommand, value: unknown, header?: string | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BlogError(400, "BAD_INPUT", "Blog input must be an object");
  const input = value as Record<string, unknown>;
  if (!header || BLOG_READ_COMMANDS.includes(command)) return input;
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== header) throw new BlogError(400, "BAD_INPUT", "Idempotency-Key must match the input");
  return { ...input, idempotencyKey: header };
}
