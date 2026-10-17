import { safeDocumentLink } from "@tabdo/shared";

// This bounds known URL credential forms; it does not inspect arbitrary prose or secrets.
const credentialNames = new Set([
  "key", "apikey", "xapikey", "token", "accesstoken", "refreshtoken", "idtoken",
  "authtoken", "oauthtoken", "bearertoken", "sessiontoken", "auth", "authorization",
  "signature", "sig", "secret", "clientsecret", "password", "passwd", "credential", "credentials",
]);
function hasCredentials(params: URLSearchParams) {
  return [...params.keys()].some(key => {
    const name = key.toLowerCase().replace(/[_-]/g, "");
    return credentialNames.has(name) || name.startsWith("xamz");
  });
}

export function isPublicBlogLink(href: string): boolean {
  // Also reject userinfo, including when a stored link predates document validation.
  if (!safeDocumentLink(href)) return false;
  const url = new URL(href);
  const fragment = url.hash.slice(1), queryStart = fragment.indexOf("?");
  return !/\/(?:api\/)?(?:site-files|files)\//.test(url.pathname)
    && !hasCredentials(url.searchParams)
    && !hasCredentials(new URLSearchParams(queryStart < 0 ? fragment : fragment.slice(queryStart + 1)))
    && !/(?:tab_(?:pub_)?|agt_)[A-Za-z0-9_-]{20,}/.test(href);
}
