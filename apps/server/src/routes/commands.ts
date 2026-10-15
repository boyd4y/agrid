import { createCommandsRoute } from "../business/http/commands.js";
import { getAuth } from "../resources/scope.js";
import { commandDependencies } from "../services/dependencies.js";

/** Node app owns its existing request resources; the shared route receives explicit dependencies. */
export const commandsRoute = createCommandsRoute(async () => {
  const commands = commandDependencies();
  return { commands, identity: { database: commands.database,
    resolveSession: headers => getAuth().api.getSession({ headers }),
    logger: { warn: (event, error) => console.warn(event, error) } },
    close: async () => {} };
});
