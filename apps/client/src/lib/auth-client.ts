import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:5173",
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
