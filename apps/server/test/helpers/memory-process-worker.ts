// Real official Pi + business admission + scoped transactional host tools.
// Normal runs create a fresh DB thread and sandbox. Only the explicit question fixture restores its own checkpoint.
import { readFile, writeFile } from "node:fs/promises";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { snapshotWorkspace, type WorkspaceSnapshot } from "../../src/harness/workspace.js";
import { randomUUID } from "node:crypto";
import { stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { db, client } from "../../src/db/index.js";
import { chatThreads } from "../../src/db/schema.js";
import { withNodeResources } from "../../src/resources/node.js";
import { prepareNativeChatAgent } from "../../src/harness/preparation.js";
import { resolveChatContext } from "../../src/chat/context.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { nativeHostTools, nativeToolDenial } from "../../src/harness/tools.js";
import { claimRuntimeLease, releaseRuntimeLease, withRuntimeLease } from "../../src/harness/store.js";
import type { Actor } from "../../src/auth/actor.js";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const input = JSON.parse(process.argv[2]) as { actor: Actor; agentId: string; prompt: string; env: Record<string, string>; secondPrompt?: string; checkpoint?: { path: string; action: "produce" | "consume" } };
const runtimeEnv = { ...process.env, ...input.env };
await withNodeResources(async () => {
  const saved = input.checkpoint?.action === "consume" ? JSON.parse(await readFile(input.checkpoint.path, "utf8")) as { threadId: string; sessionId: string; sandboxId: string; resumeState: HarnessAgentResumeSessionState; workspace: WorkspaceSnapshot } : undefined;
  const threadId = saved?.threadId ?? randomUUID(), sessionId = saved?.sessionId ?? randomUUID();
  if (!saved) await db.insert(chatThreads).values({ id: threadId, organizationId: input.actor.organizationId, workspaceId: input.actor.workspaceId, userId: input.actor.userId, clientId: threadId, custom: { agentId: input.agentId } });
  let lease: Awaited<ReturnType<typeof claimRuntimeLease>> | undefined;
  let opened: Awaited<ReturnType<typeof openNativeSandbox>> | undefined;
  let session: Awaited<ReturnType<ReturnType<typeof createNativeAgent>["createSession"]>> | undefined;
  try {
    const context = await resolveChatContext({ page: "ai" }, input.actor);
    const prepared = await prepareNativeChatAgent({ actor: input.actor, agentId: input.agentId, context, threadId, env: runtimeEnv });
    lease = await claimRuntimeLease(threadId, input.actor);
    const hosted = nativeHostTools(prepared.tools, work => withRuntimeLease(lease!, work), input.actor);
    const executedTools: string[] = [];
    const agent = createNativeAgent({ harness: prepared.harness, mode: prepared.mode, provider: prepared.provider, modelId: prepared.modelId, piModel: prepared.piModel, instructions: prepared.system, agentsDocument: prepared.agentsDocument, tools: hosted.tools, skills: [], lifecycle: { onToolExecutionEnd: ({ toolCall, toolOutput }) => {
      if (toolOutput.type === "tool-result" && !nativeToolDenial(toolOutput.output) && !hosted.failures.has(toolCall.toolCallId)) executedTools.push(toolCall.toolName);
    } }, stopWhen: stepCountIs(6), disabledTools: prepared.disabledTools, env: runtimeEnv });
    opened = await openNativeSandbox({ agent, mode: prepared.mode, provider: prepared.provider, sandboxId: saved?.sandboxId ?? randomUUID(), hasResumeState: Boolean(saved), workspace: saved?.workspace, env: runtimeEnv });
    session = await agent.createSession({ sessionId, sandboxSession: opened.sandbox, ...(saved ? { resumeFrom: saved.resumeState } : {}) });
    if (saved) {
      const result = await agent.continueStream({ session, toolResultContinuations: [{ type: "tool-result", toolCallId: "memory-question", toolName: "askUserQuestions", output: { type: "json", value: { action: "answered", answers: { direction: { optionIds: ["b"] } } } } }] });
      let text = "";for await (const part of result.stream) if (part.type === "text-delta") text += part.text;
      process.stdout.write(JSON.stringify({ text, threadId, failures: [...hosted.failures.values()], executedTools }));
      return;
    }
    const result = await agent.generate({ session, prompt: input.prompt });
    if (input.checkpoint?.action === "produce") {
      if (!session.hasUnfinishedTurn() || !opened.fs) throw new Error("Expected a native suspended question");
      const resumeState = await session.detach();
      await writeFile(input.checkpoint.path, JSON.stringify({ threadId, sessionId, sandboxId: opened.sandbox.id, resumeState, workspace: await snapshotWorkspace(opened.fs) }));
      session = undefined;
      process.stdout.write(JSON.stringify({ text: result.text, threadId, failures: [...hosted.failures.values()], executedTools }));
      return;
    }
    if (input.secondPrompt) {
      const second = await agent.generate({ session, prompt: input.secondPrompt });
      process.stdout.write(JSON.stringify({ text: result.text, secondText: second.text, threadId, failures: [...hosted.failures.values()], executedTools }));
    } else process.stdout.write(JSON.stringify({ text: result.text, threadId, failures: [...hosted.failures.values()], executedTools }));
  } finally {
    if (session) { await session.stop(); await session.destroy(); }
    await opened?.sandbox.destroy(); await opened?.fs?.dispose();
    if (lease) await releaseRuntimeLease(lease);
    if (input.checkpoint?.action !== "produce") await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
  }
});
await client.end();
