import assert from "node:assert/strict";
import { test } from "node:test";
import { isCalendarDate, shiftCalendarDate, CREATE_CALENDAR_VIEW_SCHEMA, QUERY_CALENDAR_VIEW_SCHEMA } from "../src/calendar-view.js";
const id = "00000000-0000-4000-8000-000000000001";
test("all-day dates validate real days without normalizing old date columns to datetime", () => {
  for (const date of ["2028-02-29", "2000-02-29", "0001-01-01"]) assert(isCalendarDate(date));
  for (const date of ["2030-02-29", "1900-02-29", "2030-04-31", "2030-13-01", "0000-01-01", "2026-01-01T00:00:00Z"]) assert(!isCalendarDate(date));
  assert.equal(shiftCalendarDate("2026-03-08", 1), "2026-03-09");
  assert.equal(shiftCalendarDate("2028-02-28", 1), "2028-02-29");
  assert.equal(CREATE_CALENDAR_VIEW_SCHEMA.parse({ tableId: id, config: { startColumnId: id } }).config.endMode, "inclusive");
  assert(!QUERY_CALENDAR_VIEW_SCHEMA.safeParse({ viewId: id, rangeStart: "2030-04-01", rangeEnd: "2030-03-01" }).success);
});
