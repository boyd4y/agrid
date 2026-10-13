import { format, isValid, parse, parseISO } from "date-fns";
export type DateFormat = "YYYY-MM-DD" | "YYYY/MM/DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "MMM D, YYYY";

const TOKEN_TO_FNS: Record<DateFormat, string> = {
  "YYYY-MM-DD": "yyyy-MM-dd",
  "YYYY/MM/DD": "yyyy/MM/dd",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "DD/MM/YYYY": "dd/MM/yyyy",
  "MMM D, YYYY": "MMM d, yyyy",
};

/** Parse stored ISO (YYYY-MM-DD) or common display strings into Date (local). */
export function parseDateValue(raw: string | null | undefined): Date | undefined {
  if (!raw || !String(raw).trim()) return undefined;
  const s = String(raw).trim();
  // Prefer ISO date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = parseISO(s);
    return isValid(d) ? d : undefined;
  }
  for (const fmt of Object.values(TOKEN_TO_FNS)) {
    const d = parse(s, fmt, new Date());
    if (isValid(d)) return d;
  }
  const fallback = new Date(s);
  return isValid(fallback) ? fallback : undefined;
}

/** Store as YYYY-MM-DD */
export function toStorageDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function formatDateDisplay(
  raw: string | null | undefined,
  dateFormat: DateFormat = "YYYY-MM-DD"
): string {
  const d = parseDateValue(raw ?? null);
  if (!d) return "";
  return format(d, TOKEN_TO_FNS[dateFormat] ?? "yyyy-MM-dd");
}

export function dateFormatToFns(dateFormat: DateFormat = "YYYY-MM-DD"): string {
  return TOKEN_TO_FNS[dateFormat] ?? "yyyy-MM-dd";
}
