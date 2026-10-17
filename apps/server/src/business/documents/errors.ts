import { ServiceError } from "../errors.js";
export class DocumentError extends ServiceError {
  constructor(status: number, readonly code: "BAD_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "VERSION_CONFLICT" | "ALREADY_EXISTS" | "IDEMPOTENCY_MISMATCH" | "ATTACHMENT_LIMIT" | "STORAGE_UNAVAILABLE", message: string) { super(status, { message }); }
}
