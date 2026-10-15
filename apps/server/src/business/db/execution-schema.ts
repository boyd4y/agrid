import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentRuns } from "./schema.js";

/** Private trusted dispatch input, never a client projection or provider credential. */
export type NativeExecutionDocument = {
  protocol: 1;
  context: Record<string, unknown>;
  prompt: string;
  boundTableId?: string;
  toolResultContinuations?: unknown[];
};
export const agentExecutions = pgTable("agent_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  fence: integer("fence").notNull(),
  leaseToken: uuid("lease_token").notNull(),
  input: jsonb("input").$type<NativeExecutionDocument>().notNull(),
  status: text("status").$type<"accepted" | "invoking" | "settled">().default("accepted").notNull(),
  lastCursor: integer("last_cursor").default(0).notNull(),
  error: text("error"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  invokedAt: timestamp("invoked_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, t => [
  uniqueIndex("agent_executions_run_fence_idx").on(t.runId, t.fence),
  index("agent_executions_dispatch_idx").on(t.status, t.acceptedAt),
  check("agent_executions_status_check", sql`${t.status} in ('accepted','invoking','settled')`),
  check("agent_executions_cursor_check", sql`${t.lastCursor} >= 0`),
]);
export const agentExecutionChunks = pgTable("agent_execution_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  executionId: uuid("execution_id").notNull().references(() => agentExecutions.id, { onDelete: "cascade" }),
  cursor: integer("cursor").notNull(),
  chunk: jsonb("chunk").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("agent_execution_chunks_cursor_idx").on(t.executionId, t.cursor),
  check("agent_execution_chunks_cursor_check", sql`${t.cursor} > 0`),
]);
