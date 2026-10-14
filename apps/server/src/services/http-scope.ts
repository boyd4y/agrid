import type { BackendRequestScope } from "@tabdo/backend/http/request";
import { getStorageAdapter, uploadLimits } from "../storage/adapter.js";
import { integrationCapabilities } from "../integrations/dependencies.js";
import { getAuth } from "../resources/scope.js";
import { commandDependencies } from "./backend-facade.js";
import { loadBuiltinSkillDocuments } from "../skills/builtin-loader.js";
import { getAgentToolCatalog } from "../harness/tool-catalog.js";
import { withUserKeyInvitation } from "../auth/key-invitation-context.js";
import { discardQuestionSandbox } from "../harness/question-sandboxes.js";

const builtinSkills = loadBuiltinSkillDocuments();

/** Node-only ports. The public HTTP factories themselves remain Web portable. */
export async function acquireNodeBackendScope(_request: Request): Promise<BackendRequestScope> {
  const commands = commandDependencies();
  return {
    commands,
    integrations: integrationCapabilities(),
    files: { storage: getStorageAdapter, limits: uploadLimits() },
    identity: { database: commands.database, resolveSession: headers => getAuth().api.getSession({ headers }) },
    builtinSkills, toolCatalog: getAgentToolCatalog,
    async invite(actor, input, headers) {
      const create = () => getAuth().api.createInvitation({ body: { ...input, organizationId: actor.organizationId }, headers });
      return actor.kind === "human" && /^bearer tab_/i.test(headers.get("authorization") ?? "")
        ? withUserKeyInvitation(actor, create) : create();
    },
    discardRuntime: discardQuestionSandbox,
    logger: { error: (event, error) => console.error(event, error) },
    // The application composition owns its long-lived pool.
    async close() {},
  };
}
