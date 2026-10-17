import type { CalendarErrorCode } from "@tabdo/shared";
import { ServiceError } from "../errors.js";
export class CalendarError extends ServiceError {
  constructor(status: number, public readonly code: CalendarErrorCode, message: string) { super(status, { message }); this.name = "CalendarError"; }
}

export function calendarDatabaseError(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    const details = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (details.code === "23505" && (details.constraint_name ?? details.constraint) === "calendar_people_bound_user_key")
      throw new CalendarError(409, "RESOURCE_CONFLICT", "This human member already has a stable service person record in this workspace");
    current = details.cause;
  }
  throw error;
}
