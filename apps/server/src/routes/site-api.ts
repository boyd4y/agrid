import { getConnInfo } from "@hono/node-server/conninfo";
import { createSiteApiRoutes, createSiteKeysRoute } from "../business/http/site-api.js";
import { acquireRequestScope } from "../services/http-scope.js";

export const siteApiRoute = createSiteApiRoutes(acquireRequestScope, { graphiql: process.env.NODE_ENV === "development",
  publicOrigin: process.env.BETTER_AUTH_URL || process.env.APP_URL,
  clientIp(context) {
    try { return getConnInfo(context).remote.address ?? "unknown"; } catch { return "unknown"; }
  },
});
export const siteKeysRoute = createSiteKeysRoute(acquireRequestScope);
