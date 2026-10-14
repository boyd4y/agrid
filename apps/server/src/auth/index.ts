import { db } from "../db/index.js";
import { sendInviteEmail } from "./email.js";
import { userKeyInvitationContext } from "./key-invitation-context.js";
import { createPlatformAuth, DEV_SECRET, assertProductionAuthSecret } from "@tabdo/platform/auth";

const secret = process.env.NODE_ENV === "production"
  ? assertProductionAuthSecret(process.env.BETTER_AUTH_SECRET)
  : process.env.BETTER_AUTH_SECRET || DEV_SECRET;
export const auth = createPlatformAuth({
  database: db,
  appUrl: process.env.APP_URL || "http://localhost:5173",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  secret,
  production: process.env.NODE_ENV === "production",
  hooks: { before: userKeyInvitationContext },
  sendInviteEmail,
});
export type AuthSession = typeof auth.$Infer.Session;
