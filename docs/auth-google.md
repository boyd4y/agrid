# Google OAuth

Google sign-in is optional. In Google Cloud Console, configure the OAuth consent screen (add test users while in testing), then create an OAuth client with application type **Web application**.

Set the authorized JavaScript origin to your SPA origin (`APP_URL`). Add the exact authorized redirect URI:

```
{BETTER_AUTH_URL}/api/auth/callback/google
```

For local development this is usually `http://localhost:3001/api/auth/callback/google`. Production must use the public API URL and HTTPS.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server, alongside the existing Better Auth URL and secret configuration, and restart the server. Never put the client secret in Vite/client environment variables.

Both credentials must be non-empty after trimming. Missing or incomplete configuration disables Google sign-in and hides the button without preventing startup. The SPA reads the public `/api/public/auth-features` endpoint; failed requests also hide the button.

Google is NOT a trusted auto-link provider while password emails are unverified. Account linking remains enabled under Better Auth defaults for verified ownership. Password signup does not currently require email verification. Operators who later implement email verification may reconsider `trustedProviders`.

New OAuth users receive a workspace through the existing authenticated route's organization initializer.
