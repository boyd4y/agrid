import { isBlogCommand, blogTransportInput } from "../blogs/transport.js";
import { BlogError } from "../blogs/errors.js";
import { bodyLimit } from "hono/body-limit";
import { DocumentError } from "../documents/errors.js";
import { isDocumentCommand, documentTransportInput } from "../documents/transport.js";
import { CalendarError } from "../calendar/errors.js";
import { isCalendarCommand, calendarTransportInput } from "../calendar/transport.js";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveActor, type ActorDependencies } from "../auth/actor.js";
import type { CommandDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";
import { dispatchCommand } from "../services/command-dispatch.js";

export type CommandRequestScope = Readonly<{
  commands: CommandDependencies;
  identity: ActorDependencies;
  close(): Promise<void>;
}>;

/** Thin Web HTTP entry; resource lifetime belongs to the deployment composition. */
export function createCommandsRoute(acquire: (request: Request) => Promise<CommandRequestScope>) {
  const route = new Hono();
  route.use("*", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  route.post("/", async c => {
    const scope = await acquire(c.req.raw);
    try {
      const actor = await resolveActor(c.req.raw, scope.identity);
      if (!actor) return c.json({ error: "未授权：需要登录或 Agent API Key" }, 401);
      const body = await c.req.json();
      if (body && typeof body.command === "string" && isCalendarCommand(body.command)) body.input = calendarTransportInput(body.command, body.input ?? {}, c.req.header("Idempotency-Key"));
      if (body && typeof body.command === "string" && isBlogCommand(body.command)) body.input = blogTransportInput(body.command, body.input ?? {}, c.req.header("Idempotency-Key"));
      if (body && typeof body.command === "string" && isDocumentCommand(body.command)) body.input = documentTransportInput(body.command, body.input ?? {}, c.req.header("Idempotency-Key"));
      c.header("Cache-Control", "private, no-store");
      return c.json(await dispatchCommand(scope.commands, actor, body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "命令执行失败";
      const status = error instanceof ServiceError ? error.status : message.includes("版本冲突") ? 409 : 400;
      return c.json({ error: message, ...(error instanceof BlogError || error instanceof CalendarError || error instanceof DocumentError ? { code: error.code } : {}) }, status as ContentfulStatusCode);
    } finally { await scope.close(); }
  });
  return route;
}
