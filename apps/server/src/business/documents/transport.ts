import { DOCUMENT_COMMANDS, DOCUMENT_READ_COMMANDS, type DocumentCommand } from "@tabdo/shared";
import { DocumentError } from "./errors.js";
export const isDocumentCommand = (name: string): name is DocumentCommand => (DOCUMENT_COMMANDS as readonly string[]).includes(name);
export function documentTransportInput(command: DocumentCommand, value: unknown, header?: string | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentError(400, "BAD_INPUT", "Document input must be an object");
  const input = value as Record<string, unknown>;
  if (!header || DOCUMENT_READ_COMMANDS.includes(command)) return input;
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== header) throw new DocumentError(400, "BAD_INPUT", "Idempotency-Key must match the input");
  return { ...input, idempotencyKey: header };
}
