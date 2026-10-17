import { CALENDAR_COMMANDS, CALENDAR_READ_COMMANDS, type CalendarCommand } from "@tabdo/shared";
import { CalendarError } from "./errors.js";
export const isCalendarCommand = (command: string): command is CalendarCommand => (CALENDAR_COMMANDS as readonly string[]).includes(command);
export function calendarTransportInput(command: CalendarCommand, raw: unknown, header?: string | null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CalendarError(400, "BAD_INPUT", "Calendar input must be an object");
  const input = raw as Record<string, unknown>;
  if (!header || CALENDAR_READ_COMMANDS.includes(command)) return input;
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== header) throw new CalendarError(400, "BAD_INPUT", "Idempotency-Key header and input must match");
  return { ...input, idempotencyKey: header };
}
