import { Temporal } from "@js-temporal/polyfill";
import type { WorkingWindow } from "@tabdo/shared";
import { CalendarError } from "./errors.js";

export type Interval = { start: number; end: number };
export function parseBookingTime(input: { start: string; end: string; timeZone: string }): Interval {
  try {
    // An explicit offset is checked against the zone. Z is an exact UTC instant.
    const start = Temporal.ZonedDateTime.from(`${input.start}[${input.timeZone}]`, { offset: "reject", overflow: "reject" }).epochMilliseconds;
    const end = Temporal.ZonedDateTime.from(`${input.end}[${input.timeZone}]`, { offset: "reject", overflow: "reject" }).epochMilliseconds;
    if (end <= start || end - start > 86400000 || start % 60000 || end % 60000) throw new RangeError();
    return { start, end };
  } catch { throw new CalendarError(400, "BAD_INPUT", "Use real dates, whole minutes and an offset valid in the supplied IANA time zone"); }
}
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;
const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Iterate actual minutes, so folds include both offsets and gaps never invent time.
 * At most 31 days per public query; booking validation is bounded to 24 hours.
 */
export function openIntervals(timeZone: string, windows: WorkingWindow[], exceptions: { date: string; intervals: { start: string; end: string }[] }[], range: Interval) {
  const format = new Intl.DateTimeFormat("en-US-u-nu-latn", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const byDate = new Map<string, { start: string; end: string }[]>();
  for (const exception of exceptions) byDate.set(exception.date, [...(byDate.get(exception.date) ?? []), ...exception.intervals]);
  const output: Interval[] = [];
  let current: Interval | undefined;
  for (let point = Math.ceil(range.start / 60000) * 60000; point + 60000 <= range.end; point += 60000) {
    const p = Object.fromEntries(format.formatToParts(point).map(part => [part.type, part.value]));
    const clock = `${p.hour}:${p.minute}`, date = `${p.year}-${p.month}-${p.day}`;
    const open = windows.some(window => window.day === weekdays[p.weekday] && window.start <= clock && clock < window.end)
      && !(byDate.get(date) ?? []).some(interval => interval.start <= clock && clock < interval.end);
    if (!open) { current = undefined; continue; }
    if (current?.end === point) current.end += 60000;
    else { current = { start: point, end: point + 60000 }; output.push(current); }
  }
  return output;
}
export function subtractBusy(open: Interval[], busy: Interval[]) {
  let result = open;
  for (const block of busy) result = result.flatMap(slot => !overlaps(slot, block) ? [slot] : [
    ...(slot.start < block.start ? [{ start: slot.start, end: block.start }] : []),
    ...(slot.end > block.end ? [{ start: block.end, end: slot.end }] : []),
  ]);
  return result;
}
