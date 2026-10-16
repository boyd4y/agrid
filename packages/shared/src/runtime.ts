import { z } from "zod";

export const SANDBOX_PROVIDERS = ["vercel", "e2b", "railway"] as const;
export const sandboxProviderSchema = z.enum(SANDBOX_PROVIDERS);
export type SandboxProvider = z.infer<typeof sandboxProviderSchema>;
export type RuntimeProvider = "local" | SandboxProvider;
export type RuntimeMode = "local" | "sandbox";
export type RuntimeProviderStatus = { id: RuntimeProvider; available: boolean; hint?: string; reason?: "railway_harness_unavailable" };
