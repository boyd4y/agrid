import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { SITE_SAVE_SCHEMA } from "@tabdo/shared";
import type { CommandDependencies } from "../../dependencies.js";
import type { Transaction } from "../../db/types.js";
import * as sites from "../../sites/service.js";

export function createSiteTools(source: CommandDependencies | (() => CommandDependencies), organizationId?: string, actorId?: string, transaction?: Transaction | (() => Transaction | undefined)): ToolSet {
  const deps = () => typeof source === "function" ? source() : source;
  const tx = () => typeof transaction === "function" ? transaction() : transaction;
  const org = { organizationId, actorId };
  return {
    list_sites: tool({ description: "列出当前工作区的站点及最新版本、发布状态和访问地址。", inputSchema: zodSchema(z.strictObject({})), execute: () => sites.listSites(deps(), org, tx()) }),
    get_site: tool({ description: "读取站点版本、文件和版本历史。提供path只返回该文件内容；修改前读取最新version。", inputSchema: zodSchema(z.strictObject({ siteId: z.uuid(), revisionId: z.uuid().optional(), path: z.string().optional() })), execute: input => sites.getSite(deps(), { ...input, ...org }, tx()) }),
    save_site: tool({ description: "保存完整HTML/CSS/JS站点文件并创建持久版本，必须包含index.html。修改传siteId及expectedVersion，files是完整文件集；tabdo.js由平台提供。保存后可open_preview(kind=site,siteId)预览，不会改变已发布版本。", inputSchema: zodSchema(SITE_SAVE_SCHEMA), execute: input => sites.saveSite(deps(), { ...input, ...org }, tx()) }),
    publish_site: tool({ description: "将指定站点版本发布到稳定公网地址。只有用户要求发布时使用；先get_site核对revisionId及文件，发布不运行智能体。", inputSchema: zodSchema(z.strictObject({ siteId: z.uuid(), revisionId: z.uuid() })), execute: input => sites.publishSite(deps(), { ...input, ...org }, tx()) }),
    unpublish_site: tool({ description: "撤下公开站点，保留源文件和历史版本。", inputSchema: zodSchema(z.strictObject({ siteId: z.uuid() })), execute: input => sites.unpublishSite(deps(), { ...input, ...org }, tx()) }),
  };
}
