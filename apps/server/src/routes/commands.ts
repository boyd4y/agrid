import { AUTOMATION_DATA_COMMAND_SCHEMAS, COMMANDS } from "@tabdo/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { resolveActor } from "../auth/actor.js";
import * as cmds from "../commands/index.js";

export const commandsRoute = new Hono();

/**
 * POST /api/commands
 * Body: { command, input }
 * Auth: session cookie (human) OR Authorization: Bearer agt_... (agent)
 * Same permission gate for both kinds.
 * Tenant: organizationId is derived from actor — never trusted from client body.
 */
commandsRoute.post("/", async (c) => {
  const actor = await resolveActor(c.req.raw);
  const authRequired = process.env.AUTH_REQUIRED === "true";

  if (authRequired && !actor) {
    return c.json({ error: "未授权：需要登录或 Agent API Key" }, 401);
  }

  try {
    const body = z
      .object({
        command: z.enum(COMMANDS),
        input: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(await c.req.json());

    const organizationId = actor?.organizationId?.trim() || "";
    if (!organizationId) {
      return c.json({ error: "缺少组织上下文：请先加入或选择工作区" }, 401);
    }

    if (Object.hasOwn(body.input, "skipAutomation") || Object.hasOwn(body.input, "actorId")) {
      return c.json({ error: "内部执行选项不能通过 API 设置" }, 400);
    }
    // Strip any client-supplied organizationId; server actor is authoritative
    const { organizationId: _ignored, ...safeInput } = body.input as Record<
      string,
      unknown
    > & { organizationId?: unknown };

    const input = Object.hasOwn(AUTOMATION_DATA_COMMAND_SCHEMAS, body.command)
      ? AUTOMATION_DATA_COMMAND_SCHEMAS[body.command as keyof typeof AUTOMATION_DATA_COMMAND_SCHEMAS].parse(safeInput)
      : safeInput;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (cmds as any)[body.command];
    if (typeof fn !== "function") {
      return c.json({ error: `未知命令 ${body.command}` }, 400);
    }
    const result = await fn({ ...input, organizationId, actorId: actor?.userId });
    return c.json({
      ok: true,
      command: body.command,
      result,
      actor: actor
        ? { kind: actor.kind, userId: actor.userId, role: actor.role }
        : null,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return c.json({ error: `命令输入无效: ${e.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}` }, 400);
    }
    const msg = e instanceof Error ? e.message : "命令执行失败";
    const status = e instanceof HTTPException ? e.status : msg.includes("版本冲突") ? 409 : 400;
    return c.json({ error: msg }, status);
  }
});
