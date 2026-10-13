import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendInviteEmail } from "./email.js";

const appUrl = process.env.APP_URL || "http://localhost:5173";
/** Dev-only fallback — never valid in production. */
const DEV_SECRET = "dev-only-secret-change-me-32chars-min!!";
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
function assertProductionAuthSecret(raw: string | undefined): string {
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

const isProd = process.env.NODE_ENV === "production";
const secret = isProd
  ? assertProductionAuthSecret(process.env.BETTER_AUTH_SECRET)
  : process.env.BETTER_AUTH_SECRET || DEV_SECRET;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  basePath: "/api/auth",
  secret,
  trustedOrigins: [appUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
  database: drizzleAdapter(db, {
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
        await sendInviteEmail({
          to: data.email,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name || data.inviter.user.email,
          inviteLink,
        });
      },
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
