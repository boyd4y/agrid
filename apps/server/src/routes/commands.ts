import { createCommandsRoute } from "@tabdo/backend/http/commands";
import { getAuth } from "../resources/scope.js";
import { commandDependencies } from "../services/backend-facade.js";

/** Node app owns its existing request resources; the shared route receives explicit dependencies. */
export const commandsRoute = createCommandsRoute(async () => {
  const commands = commandDependencies();
  return { commands, identity: { database: commands.database,
    resolveSession: headers => getAuth().api.getSession({ headers }),
    logger: { warn: (event, error) => console.warn(event, error) } },
    close: async () => {} };
});
