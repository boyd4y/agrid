import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";
import * as schema from "./schema.js";

/** Dev-only fallback — never valid in production. */
export const DEV_SECRET = "dev-only-secret-change-me-32chars-min!!";
/** Known placeholder / example values that must not be used in production. */
const KNOWN_INSECURE_SECRETS = new Set([
  DEV_SECRET,
  "replace-with-32+-char-secret",
]);

/**
 * Production: require BETTER_AUTH_SECRET to be a random secret ≥32 chars.
 * Rejects missing, known defaults/examples, short, whitespace-only, and
 * all-same-character strings. This is a basic hygiene check — not a
 * cryptographic entropy proof; generate a real random secret for deploy.
 */
export function assertProductionAuthSecret(raw: string | undefined): string {
  const secret = raw ?? "";
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to a random secret (≥32 chars) in production"
    );
  }
  if (trimmed.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be a random secret ≥32 chars in production"
    );
  }
  if (KNOWN_INSECURE_SECRETS.has(secret) || KNOWN_INSECURE_SECRETS.has(trimmed)) {
    throw new Error(
      "BETTER_AUTH_SECRET must not use a known default or example value in production"
    );
  }
  if (/^(.)\1+$/.test(trimmed)) {
    throw new Error(
      "BETTER_AUTH_SECRET must not be a repeated single character in production"
    );
  }
  return secret;
}

export type GoogleAuthCredentials = { clientId: string; clientSecret: string };

export function isGoogleAuthConfigured(google?: GoogleAuthCredentials): boolean {
  return Boolean(google?.clientId.trim() && google?.clientSecret.trim());
}

export function resolveSocialProviders(google?: GoogleAuthCredentials): BetterAuthOptions["socialProviders"] {
  if (!google || !isGoogleAuthConfigured(google)) return undefined;
  return { google: { clientId: google.clientId.trim(), clientSecret: google.clientSecret.trim() } };
}

export function createAuth(options: {
  database: Parameters<typeof drizzleAdapter>[0];
  appUrl: string;
  baseURL: string;
  secret: string;
  production: boolean;
  hooks?: BetterAuthOptions["hooks"];
  google?: GoogleAuthCredentials;
  sendInviteEmail: (input: { to: string; organizationName: string; inviterName: string; inviteLink: string }) => Promise<unknown>;
}) {
  if (!options.secret.trim()) throw new Error("Missing authentication secret");
  if (options.production) assertProductionAuthSecret(options.secret);
  const appUrl = options.appUrl;
  return betterAuth({
    baseURL: options.baseURL,
    basePath: "/api/auth",
    hooks: options.hooks,
    secret: options.secret,
    trustedOrigins: [appUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    socialProviders: resolveSocialProviders(options.google),
    // Keep ownership checks for linking: password signup does not verify email.
    account: { accountLinking: { enabled: true } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        kind: {
          type: "string",
          required: false,
          defaultValue: "human",
          input: false,
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        async sendInvitationEmail(data) {
          const inviteLink = `${appUrl}/invite/${data.id}`;
          await options.sendInviteEmail({
            to: data.email,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
            inviteLink,
          });
        },
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
