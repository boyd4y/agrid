import { Temporal } from "temporal-polyfill";

/** Explicit offset choices for repeated hours; nonexistent wall times have no choices. */
export function wallTimeOptions(date: string, time: string, zone: string) {
  try {
    const wall = Temporal.PlainDateTime.from(`${date}T${time}`, { overflow: "reject" });
    const earlier = wall.toZonedDateTime(zone, { disambiguation: "earlier" });
    const later = wall.toZonedDateTime(zone, { disambiguation: "later" });
    return [earlier, later].filter(value => value.toPlainDateTime().equals(wall))
      .filter((value, index, all) => all.findIndex(other => other.epochMilliseconds === value.epochMilliseconds) === index)
      .map(value => ({ offset: value.offset, start: value.toInstant().toString() }));
  } catch { return []; }
}
export function bookingDraft(start: string, zone: string) {
  const local = Temporal.Instant.from(start).toZonedDateTimeISO(zone);
  return { date: local.toPlainDate().toString(), time: local.toPlainTime().toString().slice(0, 5), offset: local.offset };
}
