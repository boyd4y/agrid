import { z } from "zod";

// Accept bare addresses and display names, but never header line breaks.
const address = z.string().trim().min(1).max(320).refine(
  value => !/[\r\n]/.test(value) && /^(?:[^<>]*<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/.test(value),
  "Invalid email address",
);
const addresses = z.array(address).max(50);
const identity = (max: number) => z.string().trim().min(1).max(max).refine(value => value !== "." && value !== "..", "Invalid mail identity");
const common = {
  connectionId: z.uuid(),
  inboxId: identity(300),
  cc: addresses.optional(),
  bcc: addresses.optional(),
  replyTo: addresses.optional(),
  text: z.string().max(200_000).optional(),
  html: z.string().max(200_000).optional(),
};
const hasBody = (value: { text?: string; html?: string }) => Boolean(value.text?.trim() || value.html?.trim());
export const sendAgentMailMessageSchema = z.object({
  ...common,
  to: addresses.min(1),
  subject: z.string().max(998).optional(),
}).strict().refine(hasBody, { message: "Email body is required", path: ["text"] });
export const replyAgentMailMessageSchema = z.object({
  ...common,
  messageId: identity(1000),
  to: addresses.optional(),
  replyAll: z.boolean().optional(),
}).strict().refine(hasBody, { message: "Email body is required", path: ["text"] });
export type SendAgentMailMessageInput = z.infer<typeof sendAgentMailMessageSchema>;
export type ReplyAgentMailMessageInput = z.infer<typeof replyAgentMailMessageSchema>;
