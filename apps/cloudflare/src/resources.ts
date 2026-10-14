import { createDatabase } from "@tabdo/backend/database";
import { createPlatformAuth } from "@tabdo/backend/auth";
import { createAuthMiddleware } from "better-auth/api";
import type { Actor } from "@tabdo/backend/auth/actor";
import { createR2Storage } from "@tabdo/platform-cloudflare/storage/r2";
import { ServiceError } from "@tabdo/backend/errors";
import type { ToolSet } from "ai";
import { createTableTools } from "@tabdo/backend/agent/tools/index";
import type { AgentToolCatalog, AgentToolCatalogItem } from "@tabdo/shared";
import type { ProductEnvironment } from "./configuration.js";
import { builtinSkills } from "./builtin-skills.js";

const harnesses = ["pi","codex","claude"] as const;
export function toolCatalog(harness: "pi" | "codex" | "claude"): AgentToolCatalog {
  const definitions: ToolSet = createTableTools(() => { throw new Error("Catalog does not execute tools"); });
  const tools: AgentToolCatalogItem[] = Object.entries(definitions).map(([id,definition]) => ({ id, name:id,
    description: typeof definition.description === "string" ? definition.description : id,
    group: id.includes("report") ? "报告" : id.includes("automation") ? "自动化" : id.includes("form") ? "表单" : id.includes("view") || id === "open_preview" ? "视图" : id.includes("relation") ? "关联记录" : "表格与记录",
    source:"platform", supportedHarnesses:[...harnesses] }));
  return { harness,supportsFiltering:true,tools };
}

/** One resource scope per request or coordinator callback. No global DB, identity, or Env. */
export async function acquireResources(env: ProductEnvironment) {
  const resource = createDatabase({ connectionString: env.DATABASE.connectionString, poolMax:1, prepare:false });
  const runtime = { database:resource.db, now:() => new Date(), uuid:() => crypto.randomUUID() };
  const authOptions = { database:resource.db, appUrl:env.APP_URL, baseURL:env.BETTER_AUTH_URL,
    secret:env.BETTER_AUTH_SECRET, production:env.ENVIRONMENT === "production", sendInviteEmail:async (input: { to:string; organizationName:string; inviterName:string; inviteLink:string }) => {
      if (!env.RESEND_API_KEY) {
        if (env.ENVIRONMENT === "production") throw new Error("Configure RESEND_API_KEY to send invitations");
        console.info("email.development-invitation",{ to:input.to,link:input.inviteLink });
        return;
      }
      const response = await fetch("https://api.resend.com/emails",{ method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},
        body:JSON.stringify({ from:env.EMAIL_FROM || "tabdo <onboarding@resend.dev>", to:[input.to], subject:`邀请你加入 ${input.organizationName}`,
          text:`${input.inviterName} 邀请你加入 ${input.organizationName}。\n${input.inviteLink}` }) });
      if (!response.ok) throw new Error(`Invitation transport failed (${response.status})`);
      await response.body?.cancel();
    } };
  try {
    const auth = createPlatformAuth(authOptions);
    const builtins = builtinSkills();
    const r2 = createR2Storage(env.FILES);
    const storage = { ...r2, driver: "s3" as const, async open(key: string) {
      try { return await r2.open(key); }
      catch (error) { if (error instanceof Error && error.message === "Object not found") error.name = "NoSuchKey";throw error; }
    } };
    return {
      auth, runtime, commands:{...runtime,automationQueueName:"automation"},
      identity:{ database:resource.db, resolveSession:(headers:Headers) => auth.api.getSession({headers}), logger:{ warn:(event:string,error:unknown) => console.warn(event,error) } },
      builtins, builtinSkills:builtins, toolCatalog,
      files: { storage(driver?: "local"|"s3") {
        if (driver === "local") throw new ServiceError(503,{message:"此文件尚未迁移到共享文件存储"});
        return storage;
      }, limits:{ maxBodyBytes:50*1024*1024,maxFileBytes:20*1024*1024,maxFiles:20 } },
      integrations:{ publicUrl:env.APP_URL,encryptionKey:env.INTEGRATION_ENCRYPTION_KEY,bodyLimit:2*1024*1024,fetch },
      async invite(actor:Actor,input:{email:string;role:"admin"|"member"},headers:Headers) {
        // A new private hook closure for this authorized invocation; no ALS or caller-supplied headers as principal.
        const invitationAuth = createPlatformAuth({ ...authOptions, hooks:{ before:createAuthMiddleware(async context => {
          if (actor.kind !== "human" || context.path !== "/organization/invite-member") return;
          const account = await context.context.internalAdapter.findUserById(actor.userId);
          if (!account || !("kind" in account) || account.kind !== "human") return;
          const now = new Date();
          return { context:{ context:{ session:{ user:account, session:{ id:`user-key:${actor.memberId}`,token:"",userId:actor.userId,
            activeOrganizationId:actor.organizationId,createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+60000),ipAddress:null,userAgent:null } } } } };
        }) } });
        return invitationAuth.api.createInvitation({ headers,body:{ ...input,organizationId:actor.organizationId } });
      },
      logger:{ error:(event:string,error:unknown) => console.error(event,error) },
      close:() => resource.close(),
    };
  } catch (error) { await resource.close();throw error; }
}
export type ProductResources = Awaited<ReturnType<typeof acquireResources>>;
