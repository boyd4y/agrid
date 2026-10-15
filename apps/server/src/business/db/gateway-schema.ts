import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentExecutions } from "./execution-schema.js";

/** A sandbox receives this narrow capability, never database or user credentials. */
export const agentExecutionGateways = pgTable("agent_execution_gateways", {
  executionId: uuid("execution_id").primaryKey().references(() => agentExecutions.id, { onDelete: "cascade" }),
  launchToken: uuid("launch_token").notNull(),
  tokenHash: text("token_hash").notNull(),
  runId: uuid("run_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  userId: text("user_id").notNull(),
  fence: integer("fence").notNull(),
  leaseToken: uuid("lease_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Only transactional database commands can complete this atomic receipt. */
export const agentExecutionToolCalls = pgTable("agent_execution_tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  executionId: uuid("execution_id").notNull().references(() => agentExecutions.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  name: text("name").notNull(),
  input: jsonb("input").notNull(),
  result: jsonb("result"),
  status: text("status").$type<"accepted" | "completed">().default("accepted").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("agent_execution_tool_calls_key_idx").on(table.executionId, table.toolCallId),
  check("agent_execution_tool_calls_status_check", sql`${table.status} in ('accepted','completed')`),
]);
