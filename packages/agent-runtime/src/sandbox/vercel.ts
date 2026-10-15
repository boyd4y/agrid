import { createVercelNetworkSandboxSession, resumeVercelNetworkSandboxSession,
  type VercelNetworkSandboxSessionCreateOptions, type VercelNetworkSandboxSessionResumeOptions } from "@ai-sdk/sandbox-vercel";
import type { SandboxAdapter } from "./types.js";

export function createVercelSandboxAdapter(options: {
  create: VercelNetworkSandboxSessionCreateOptions;
  resume: Omit<VercelNetworkSandboxSessionResumeOptions, "sandboxId">;
}): SandboxAdapter {
  return {
    networkAccessible: true,
    async create(request = {}) {
      return { session: await createVercelNetworkSandboxSession({ ...options.create,
        sandboxId: request.sandboxId, template: request.template ?? options.create.template, abortSignal: request.abortSignal }) };
    },
    async resume(request) {
      return { session: await resumeVercelNetworkSandboxSession({ ...options.resume,
        sandboxId: request.sandboxId, abortSignal: request.abortSignal }) };
    },
  };
}
