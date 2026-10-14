import { createJustBashNetworkSandboxSession } from "@ai-sdk/sandbox-just-bash";
import { InMemoryFs } from "just-bash";
import { SandboxConfigurationError, type SandboxAdapter, type SandboxCreateOptions, type SandboxResumeOptions } from "./types.js";

export function createLocalSandboxAdapter(options: {
  cwd: string;
  env: Record<string, string>;
  createFilesystem?: () => Promise<InMemoryFs>;
  restoreFilesystem?: (reference: SandboxResumeOptions) => Promise<InMemoryFs>;
}): SandboxAdapter<InMemoryFs> {
  const open = async (fs: InMemoryFs, request: SandboxCreateOptions) => ({
    session: await createJustBashNetworkSandboxSession({ ...request, fs, cwd: options.cwd, env: options.env }),
    workspace: fs,
  });
  return {
    networkAccessible: false,
    async create(request = {}) { return open(await (options.createFilesystem?.() ?? Promise.resolve(new InMemoryFs())), request); },
    async resume(request) {
      if (!options.restoreFilesystem) throw new SandboxConfigurationError("Local resume requires a persisted workspace restorer");
      return open(await options.restoreFilesystem(request), request);
    },
  };
}
