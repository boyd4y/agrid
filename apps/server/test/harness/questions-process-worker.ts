import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { createHarnessAgent } from "@tabdo/harness/agent";
import { createPiAdapter } from "@tabdo/harness/adapters/pi";
import { createLocalSandboxAdapter } from "@tabdo/sandbox/adapters/local";
import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import { tool } from "ai";
import { z } from "zod";
import { restoreWorkspace, snapshotWorkspace, type WorkspaceSnapshot } from "../../src/harness/workspace.js";

const [mode, baseUrl, stateFile, sessionId] = process.argv.slice(2);
assert(["produce", "consume"].includes(mode));assert(baseUrl.startsWith("http://127.0.0.1:"));
const saved: { resumeState: HarnessAgentResumeSessionState; workspace: WorkspaceSnapshot } | undefined = mode === "consume" ? JSON.parse(await readFile(stateFile, "utf8")) : undefined;
const fs = await restoreWorkspace(saved?.workspace);
// Deliberately use official default reattach settings and no app/DB imports.
const agent = createHarnessAgent(createPiAdapter({ providerId: "fixture", apiKey: "fixture", baseUrl,
  model: { id: "fixture", contextWindow: 262144, maxTokens: 1024, reasoning: false }, maxTokensField: "max_tokens",
}), {
  instructions: "Use the actual tools", stopWhen: [],
  tools: {
    write_marker: tool({ inputSchema: z.object({}), execute: async () => {
      let previous = 0;try { previous = Number(await fs.readFile("/workspace/marker.txt")); } catch { /* initial workspace */ }
      await fs.writeFile("/workspace/marker.txt", String(previous + 1));return { count: previous + 1 };
    } }),
    askUserQuestions: HARNESS_V1_BUILTIN_TOOLS.askUserQuestions,
  },
});
const { session: sandbox } = await createLocalSandboxAdapter({ cwd: "/workspace", env: {}, createFilesystem: async () => fs }).create({ sandboxId: `question-worker-${randomUUID()}` });
const session = await agent.createSession({ sessionId, sandboxSession: sandbox, ...(saved ? { resumeFrom: saved.resumeState } : {}) });
if (mode === "produce") {
  const result = await agent.stream({ session, prompt: "Write marker exactly once and ask direction." });for await (const _part of result.stream) { /* native slice */ }
  assert(session.hasUnfinishedTurn());
  const resumeState = await session.detach(), workspace = await snapshotWorkspace(fs);
  assert.equal(resumeState.continueFrom?.pendingToolResults?.[0].toolCallId, "question-1");
  await writeFile(stateFile, JSON.stringify({ resumeState, workspace }));
  // Actual process termination after SDK capture, not a shared in-process map.
  process.exit(0);
} else {
  try {
    assert(session.hasUnfinishedTurn());
    const result = await agent.continueStream({ session, toolResultContinuations: [{ type: "tool-result", toolCallId: "question-1", toolName: "askUserQuestions", output: { type: "json", value: { action: "answered", answers: { direction: { optionIds: ["b"] } } } } }] });
    let text = "";for await (const part of result.stream) if (part.type === "text-delta") text += part.text;
    assert.equal(text, "Native answer B, no replay.");assert.equal(await fs.readFile("/workspace/marker.txt"), "1");assert(!session.hasUnfinishedTurn());
    await session.stop();
  } finally { await session.destroy();await sandbox.destroy(); }
}
