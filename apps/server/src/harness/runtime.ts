import type { HarnessV1NetworkSandboxSession, HarnessV1Skill } from "@ai-sdk/harness";
import type { ToolSet } from "ai";
import type { InMemoryFs } from "just-bash";
import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { assertSandboxCompatibility, type HarnessAdapter, type NativeAgent, type NativeAgentSettings } from "@tabdo/platform-node/harness/types";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createCodexAdapter } from "@tabdo/platform-node/harness/codex";
import { createClaudeCodeAdapter } from "@tabdo/platform-node/harness/claude-code";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { createVercelSandboxAdapter } from "@tabdo/platform-node/sandbox/vercel";
import { HTTPException } from "hono/http-exception";
import { restoreWorkspace, type WorkspaceSnapshot } from "./workspace.js";
import type { HarnessId } from "../ai/model.js";
import type { PiModelMetadata, PiCompletion } from "./model-contracts.js";
import { validateDisabledTools } from "./tool-settings.js";
export type { NativeAgent, NativeAgentSettings };

export type { RuntimeMode } from "./contracts.js";
import type { RuntimeMode, RuntimeEnvironment as Environment } from "./contracts.js";
import { resolveNativeConfiguration, sandboxCredentials } from "./runtime-configuration.js";

/** Construct the official runtime, never a model-only or offline rules fallback. */
export function createNativeAgent(options: {
  harness: HarnessId;
  mode: RuntimeMode;
  modelId?: string;
  piModel?: PiModelMetadata;
  instructions: string;
  agentsDocument?: string;
  tools: ToolSet;
  disabledTools?: readonly string[];
  skills: readonly HarnessV1Skill[];
  runtimeContext?: Record<string, unknown>;
  env?: Environment;
  lifecycle?: Pick<NativeAgentSettings, "onStart" | "onStepStart" | "onLanguageModelCallStart" | "onLanguageModelCallEnd" | "onToolExecutionStart" | "onToolExecutionEnd" | "onStepEnd" | "onEnd">;
  stopWhen?: NativeAgentSettings["stopWhen"];
  onPiMessageEnd?: (completion: PiCompletion) => void;
  consumePiContinuationInput?: () => string | undefined;
}): NativeAgent {
  const env = options.env ?? process.env;
  const configuration = resolveNativeConfiguration({ ...options, env });
  const adapter: HarnessAdapter = configuration.harness === "pi"
    ? createPiAdapter({ ...configuration.adapter, onMessageEnd: options.onPiMessageEnd, consumeContinuationInput: options.consumePiContinuationInput })
    : configuration.harness === "codex" ? createCodexAdapter(configuration.adapter) : createClaudeCodeAdapter(configuration.adapter);

  const document =
    options.agentsDocument?.trim() ||
    "# AGENTS.md\n\n遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。";
  assertSandboxCompatibility(adapter, options.mode === "sandbox");
  return createHarnessAgent(adapter, {
    ...options.lifecycle,
    tools: options.tools,
    inactiveTools: validateDisabledTools(options.harness, options.disabledTools),
    skills: options.skills,
    runtimeContext: options.runtimeContext,
    stopWhen: options.stopWhen,
    instructions: `${options.instructions}\n\n工作区 AGENTS.md：\n${document}`,
    sandboxConfig: {
      workDir: "agent",
      onSession: async ({ session, sessionWorkDir, abortSignal }) => {
        await session.writeTextFile({
          path: `${sessionWorkDir}/AGENTS.md`,
          content: document,
          abortSignal,
        });
      },
    },
  });
}

/** A resumed local Pi gets its isolated filesystem back; remote sandboxes use SDK lookup. */
export async function openNativeSandbox(options: {
  agent: NativeAgent;
  mode: RuntimeMode;
  sandboxId: string;
  hasResumeState: boolean;
  workspace?: WorkspaceSnapshot | null;
  signal?: AbortSignal;
  env?: Environment;
}): Promise<{ sandbox: HarnessV1NetworkSandboxSession; fs?: InMemoryFs }> {
  if (options.mode === "local") {
    if (options.hasResumeState && !options.workspace)
      throw new HTTPException(409, {
        message: "本地原生工作区快照缺失，无法恢复；请新建对话",
      });
    const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: {},
      createFilesystem: () => restoreWorkspace(options.workspace),
      restoreFilesystem: () => restoreWorkspace(options.workspace),
    });
    const request = { sandboxId: options.sandboxId, abortSignal: options.signal };
    const opened = options.hasResumeState ? await adapter.resume(request) : await adapter.create(request);
    return { sandbox: opened.session, fs: opened.workspace };
  }

  const credentials = sandboxCredentials(options.env ?? process.env);
  const adapter = createVercelSandboxAdapter({
    create: { ...credentials, runtime: "node24", ports: [4000] },
    resume: credentials,
  });
  const opened = options.hasResumeState
    ? await adapter.resume({ sandboxId: options.sandboxId, abortSignal: options.signal })
    : await adapter.create({ sandboxId: options.sandboxId, template: await options.agent.getSandboxTemplate(), abortSignal: options.signal });
  return { sandbox: opened.session };
}
