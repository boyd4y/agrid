import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
test("0038 preserves existing calendar grants and bookings, with independent outbound capabilities defaulting to false", async () => {
  const sql = postgres(url, { max: 1, prepare: false });
  const schema = `subscription_migration_${randomUUID().replaceAll("-", "")}`, rollback = new Error("owned fixture rollback");
  try {
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await tx.unsafe(`CREATE TABLE "user" (id text PRIMARY KEY);
        CREATE TABLE calendars (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, UNIQUE(id,workspace_id));
        CREATE TABLE bookings (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, title text NOT NULL);
        CREATE TABLE api_key_calendars (key_id uuid NOT NULL, calendar_id uuid NOT NULL,
          can_read boolean NOT NULL, can_read_availability boolean NOT NULL, can_create boolean NOT NULL,
          can_update boolean NOT NULL, can_cancel boolean NOT NULL, can_manage boolean NOT NULL, can_trigger_agent boolean NOT NULL,
          CONSTRAINT api_key_calendars_capability CHECK (can_read OR can_read_availability OR can_create OR can_update OR can_cancel OR can_manage OR can_trigger_agent));`);
      const keyId = randomUUID(), calendarId = randomUUID(), workspaceId = randomUUID(), bookingId = randomUUID();
      await tx`INSERT INTO calendars VALUES (${calendarId},${workspaceId})`;
      await tx`INSERT INTO bookings VALUES (${bookingId},${workspaceId},'Preserved customer')`;
      await tx`INSERT INTO api_key_calendars VALUES (${keyId},${calendarId},false,false,false,false,false,true,false)`;
      const [before] = await tx`SELECT * FROM api_key_calendars`;
      const migration = readFileSync(new URL("../../drizzle/0038_calendar_event_subscriptions.sql", import.meta.url), "utf8").replaceAll('"public".', `"${schema}".`);
      for (const statement of migration.split("--> statement-breakpoint").filter(v => v.trim())) await tx.unsafe(statement);
      const [after] = await tx`SELECT * FROM api_key_calendars`;
      const { can_subscribe, can_read_deliveries, can_manage_subscriptions, ...old } = after;
      assert.deepEqual(old, before); assert.equal(can_subscribe, false); assert.equal(can_read_deliveries, false); assert.equal(can_manage_subscriptions, false);
      assert.deepEqual((await tx`SELECT * FROM bookings`)[0], { id: bookingId, workspace_id: workspaceId, title: "Preserved customer" });
      for (const name of ["calendar_events", "calendar_subscriptions", "calendar_deliveries", "calendar_delivery_attempts"]) assert.equal((await tx.unsafe(`SELECT count(*)::int AS count FROM ${name}`))[0].count, 0);
      // A management grant does not accidentally imply outbound authority. Each new capability also stands alone.
      for (const column of ["can_subscribe", "can_read_deliveries", "can_manage_subscriptions"]) await tx.unsafe(`UPDATE api_key_calendars SET can_manage=false, can_subscribe=${column === "can_subscribe"}, can_read_deliveries=${column === "can_read_deliveries"}, can_manage_subscriptions=${column === "can_manage_subscriptions"}`);
      throw rollback;
    }), error => error === rollback);
  } finally { await sql.end(); }
});
