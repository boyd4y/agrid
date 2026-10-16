import { createSitesRoute, createSiteAssetsRoute } from "../business/http/sites.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const sitesRoute = createSitesRoute(acquireRequestScope);
export const siteAssetsRoute = createSiteAssetsRoute(acquireRequestScope);
