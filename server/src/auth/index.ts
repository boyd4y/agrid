import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendInviteEmail } from "./email.js";

const appUrl = process.env.APP_URL || "http://localhost:5173";
const secret =
  process.env.BETTER_AUTH_SECRET ||
  "dev-only-secret-change-me-32chars-min!!";

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
