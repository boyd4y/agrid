import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
assert.equal(process.env.DATABASE_URL_UNPOOLED, url);

test("reminder migration preserves old Key capabilities without granting plans or agent triggers", async () => {
  // DDL changes SELECT *'s result shape within this same fixture connection.
  const sql = postgres(url, { max: 1, prepare: false });
  const schema = `reminder_migration_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("fixture rollback");
  try {
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await tx.unsafe(`
        CREATE TABLE "user" (id text PRIMARY KEY);
        CREATE TABLE api_keys (id uuid PRIMARY KEY, key_hash text NOT NULL);
        CREATE TABLE workspaces (id uuid PRIMARY KEY);
        CREATE TABLE bookings (id uuid PRIMARY KEY, workspace_id uuid NOT NULL);
        CREATE TABLE automations (id uuid PRIMARY KEY);
        CREATE TABLE automation_events (id uuid PRIMARY KEY);
        CREATE TABLE api_key_calendars (key_id uuid NOT NULL, calendar_id uuid NOT NULL,
          can_read boolean NOT NULL, can_read_availability boolean NOT NULL,
          can_create boolean NOT NULL, can_update boolean NOT NULL,
          can_cancel boolean NOT NULL, can_manage boolean NOT NULL,
          CONSTRAINT api_key_calendars_capability CHECK (
            can_read OR can_read_availability OR can_create OR can_update OR can_cancel OR can_manage));
      `);
      const keyId = randomUUID(), calendarId = randomUUID(), bookingId = randomUUID(), workspaceId = randomUUID();
      await tx`INSERT INTO api_keys VALUES (${keyId}, 'preserved-old-hash')`;
      await tx`INSERT INTO workspaces VALUES (${workspaceId})`;
      await tx`INSERT INTO bookings VALUES (${bookingId}, ${workspaceId})`;
      await tx`INSERT INTO api_key_calendars VALUES (${keyId}, ${calendarId}, false, false, false, false, false, true)`;
      const before = await tx`SELECT * FROM api_key_calendars`;
      const raw = readFileSync(new URL("../../drizzle/0035_calendar_agent_reminders.sql", import.meta.url), "utf8")
        .replaceAll('"public".', `"${schema}".`);
      for (const statement of raw.split("--> statement-breakpoint").filter(value => value.trim())) await tx.unsafe(statement);
      const [after] = await tx`SELECT * FROM api_key_calendars`;
      const { can_trigger_agent: trigger, ...oldGrant } = after;
      assert.equal(trigger, false); assert.deepEqual(oldGrant, before[0]);
      assert.equal((await tx`SELECT key_hash FROM api_keys WHERE id=${keyId}`)[0].key_hash, "preserved-old-hash");
      assert.equal((await tx`SELECT count(*)::int AS count FROM api_key_schedules`)[0].count, 0);
      assert.equal((await tx`SELECT count(*)::int AS count FROM booking_reminders`)[0].count, 0);
      assert.equal((await tx`SELECT count(*)::int AS count FROM booking_reminder_intents`)[0].count, 0);
      const preserved = await tx`SELECT id, workspace_id FROM bookings`;
      assert.equal(preserved.length, 1); assert.deepEqual(preserved[0], { id: bookingId, workspace_id: workspaceId });
      throw rollback;
    }), error => error === rollback);
  } finally { await sql.end(); }
});
