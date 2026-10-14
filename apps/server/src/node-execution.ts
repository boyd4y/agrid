import { fileURLToPath } from "node:url";
import { createNodeProcessExecution } from "@tabdo/execution/adapters/node-process";
import { createDispatchedNativeStream, dispatchAcceptedNativeExecutions } from "./harness/run-response.js";
import { withNodeResources } from "./resources/node.js";

/** Deployment composition only; public chat requests never select an execution provider. */
export function createNodeExecution(env: NodeJS.ProcessEnv) {
  const selected = env.NATIVE_EXECUTION_ADAPTER ?? "embedded";
  if (selected === "embedded") return { stream: undefined, start() {}, stopDispatch() {}, async close() {} };
  if (selected !== "node-process") throw new Error("NATIVE_EXECUTION_ADAPTER must be embedded or node-process");
  const childEnv: Record<string, string> = {};
  // Trusted runner configuration remains in the control process, never the launch body.
  for (const name of ["PATH", "NODE_ENV", "DATABASE_URL", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL",
    "PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "PI_CONTEXT_WINDOW", "PI_MAX_OUTPUT_TOKENS", "PI_MODEL_METADATA_TIMEOUT_MS",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_BASE_URL", "CODEX_MODEL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_API_KEY", "CLAUDE_MODEL",
    "VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID", "VERCEL_OIDC_TOKEN",
    "AI_RUN_POLL_MS", "AI_CHAT_TOTAL_MS", "AI_CHAT_STEP_MS", "AI_CHAT_FIRST_CHUNK_MS", "AI_CHAT_CHUNK_MS", "AI_CHAT_MAX_STEPS"])
    if (env[name] !== undefined) childEnv[name] = env[name]!;
  childEnv.DB_POOL_MAX = env.RUNNER_DB_POOL_MAX ?? "2";
  const source = import.meta.url.endsWith(".ts");
  const execution = createNodeProcessExecution({ executable: process.execPath, cwd: process.cwd(), env: childEnv,
    args: [...(source ? process.execArgv : []), fileURLToPath(new URL(source ? "./runner/node-entry.ts" : "./runner/node-entry.js", import.meta.url))] });
  let timer: ReturnType<typeof setInterval> | undefined, busy = false, stopped = false;
  async function dispatch() {
    if (busy || stopped) return;
    busy = true;
    try {
      const results = await withNodeResources(() => dispatchAcceptedNativeExecutions(execution));
      if (results.some(result => result.status === "rejected")) console.warn("agent.dispatch.retry-pending");
    } catch { console.warn("agent.dispatch.unavailable"); }
    finally { busy = false; }
  }
  return {
    stream: createDispatchedNativeStream(execution),
    start() { if (!timer && !stopped) { timer = setInterval(() => void dispatch(), 5000);timer.unref();void dispatch(); } },
    stopDispatch() { stopped = true;clearInterval(timer); },
    close() { stopped = true;clearInterval(timer);return execution.close(); },
  };
}
