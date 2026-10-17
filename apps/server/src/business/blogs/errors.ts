import { ServiceError } from "../errors.js";
export class BlogError extends ServiceError {
  constructor(status: number, readonly code: "BAD_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "VERSION_CONFLICT" | "SOURCE_CHANGED" | "IDEMPOTENCY_MISMATCH" | "LIMIT_EXCEEDED" | "STORAGE_UNAVAILABLE" | "PUBLICATION_APPROVAL_REQUIRED" | "UNPUBLISH_REQUIRED", message: string) { super(status, { message }); }
}
