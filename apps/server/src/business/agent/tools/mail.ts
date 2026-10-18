import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { sendAgentMailMessageSchema, replyAgentMailMessageSchema } from "@tabdo/shared";
import type { CommandDependencies } from "../../dependencies.js";
import * as mail from "../../integrations/agentmail.js";

export function createMailTools(source: CommandDependencies | (() => CommandDependencies), organizationId?: string): ToolSet {
  const context = () => {
    if (!organizationId) throw new Error("缺少工作区上下文");
    const deps = typeof source === "function" ? source() : source;
    if (!deps.integrations) throw new Error("请先在设置中连接 AgentMail");
    return { deps: { database: deps.database, ...deps.integrations }, organizationId };
  };
  return {
    list_mail_inboxes: tool({
      description: "只读列出当前工作区已启用的 AgentMail 连接和可用邮箱。发送、回复及读取邮件必须使用此处返回的 connectionId 和 inboxId；邮箱为空时请先配置邮箱。",
      inputSchema: zodSchema(z.strictObject({ connectionId: z.uuid().optional() })),
      execute: input => { const ctx = context(); return mail.listAgentMailInboxes(ctx.deps, ctx.organizationId, input.connectionId); },
    }),
    send_email: tool({
      description: "通过已连接的 AgentMail 发送邮件，不支持附件。必须使用 list_mail_inboxes 返回的 connectionId 和 inboxId。供应商投递后不可撤回，请核对收件人和正文。",
      inputSchema: zodSchema(sendAgentMailMessageSchema),
      execute: async input => { const ctx = context(); const result = await mail.sendAgentMailMessage(ctx.deps, { ...input, organizationId: ctx.organizationId }); return { ...result, connectionId: input.connectionId, inboxId: input.inboxId }; },
    }),
    reply_email: tool({
      description: "回复 AgentMail 邮件，不支持附件。必须使用 list_mail_inboxes 返回的 connectionId 和 inboxId，并指定原邮件 messageId。供应商投递后不可撤回，请核对回复对象和正文。",
      inputSchema: zodSchema(replyAgentMailMessageSchema),
      execute: async input => { const ctx = context(); const result = await mail.replyAgentMailMessage(ctx.deps, { ...input, organizationId: ctx.organizationId }); return { ...result, connectionId: input.connectionId, inboxId: input.inboxId }; },
    }),
    get_message: tool({
      description: "只读获取 AgentMail 邮件正文与附件元信息，不下载附件。必须使用 list_mail_inboxes 返回的 connectionId 和 inboxId，并指定 messageId。",
      inputSchema: zodSchema(mail.getAgentMailMessageSchema),
      execute: input => { const ctx = context(); return mail.getAgentMailMessage(ctx.deps, { ...input, organizationId: ctx.organizationId }); },
    }),
  };
}
