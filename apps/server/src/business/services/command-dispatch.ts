import { requireWorkspace } from "../tenant/workspace.js";
import { and, eq } from "drizzle-orm";
import { COMMANDS, type CommandName } from "@tabdo/shared";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import * as commands from "../commands/index.js";
import { member } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import type { CommandDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";
import { inTransaction } from "../db/context.js";

const commandRequest = z.object({
  command: z.enum(COMMANDS),
  input: z.record(z.string(), z.unknown()).default({}),
});

/** Public command boundary shared by HTTP/MCP callers. Scope never comes from the payload. */
export async function dispatchCommand(deps: CommandDependencies, actor: Actor, value: unknown) {
  const body = commandRequest.parse(value);
  if (!actor.organizationId || !actor.memberId) throw new ServiceError(401, { message: "缺少组织上下文：请先加入或选择工作区" });
  if (Object.hasOwn(body.input, "workspaceId") || Object.hasOwn(body.input, "skipAutomation") || Object.hasOwn(body.input, "actorId")) {
    throw new ServiceError(400, { message: "内部执行选项不能通过 API 设置" });
  }
  const { organizationId: _ignored, ...safeInput } = body.input;
  // COMMANDS is the public allowlist. Internal helpers in the module are never dispatchable.
  const fn = commands[body.command as keyof typeof commands] as unknown as
    (deps: CommandDependencies, input: Record<string, unknown>, tx: Transaction) => Promise<unknown>;
  if (typeof fn !== "function") throw new ServiceError(400, { message: `未知命令 ${body.command}` });
  const result = await inTransaction(deps, undefined, async tx => {
    const [current] = await tx.select({ id: member.id }).from(member).where(and(
      eq(member.id, actor.memberId), eq(member.userId, actor.userId), eq(member.organizationId, actor.organizationId),
    )).limit(1).for("share");
    if (!current) throw new ServiceError(403, { message: "当前工作区不可访问" });
    const workspace = await requireWorkspace({ ...deps, workspaceId: actor.workspaceId ?? deps.workspaceId }, actor.organizationId, tx);
    return fn({ ...deps, workspaceId: workspace.id }, { ...safeInput, organizationId: actor.organizationId, actorId: actor.userId }, tx);
  });
  return { ok: true as const, command: body.command as CommandName, result,
    actor: { kind: actor.kind, userId: actor.userId, role: actor.role } };
}
