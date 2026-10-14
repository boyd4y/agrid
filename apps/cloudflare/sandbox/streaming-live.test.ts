import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { user, organization, member, chatMessages, agentRuns, agentExecutions, agentExecutionChunks } from "@tabdo/backend/schema";

type Stamp = { wallMs: number; monotonicMs: number };
type Delta = Stamp & { type: "reasoning-delta" | "text-delta"; id: string; delta: string; cursor: number | null };
type ProviderDelta = Stamp & { type: "reasoning" | "text"; index: number; delta: string };
const stamp = (): Stamp => ({ wallMs: Date.now(), monotonicMs: performance.now() });
const percentile = (values: number[], percentage: number) => values.length
  ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentage) - 1] : null;

/** A local fixture measurement, not a benchmark against a different deployment. */
test("live CF SSE delivers reasoning before text and persists every streamed fragment", {
  skip: process.env.TABDO_CF_STREAMING_LIVE !== "1", timeout: 240_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
  const origin = process.env.TABDO_CF_FRONTEND_ORIGIN || "http://localhost:5189";
  const fragmentDelayMs = Number(process.env.TABDO_CF_STREAM_FRAGMENT_MS ?? 5);
  assert(Number.isInteger(fragmentDelayMs) && fragmentDelayMs >= 1 && fragmentDelayMs <= 50);
  const marker = randomUUID();
  const reportPath = process.env.TABDO_CF_STREAMING_REPORT || join(tmpdir(), `tabdo-cf-streaming-${marker}.json`);
  let traceWritten = false;
  const reasoningFragments = Array.from({ length: 80 }, (_, index) => `R${String(index).padStart(3, "0")}|`);
  const textFragments = Array.from({ length: 160 }, (_, index) => `T${String(index).padStart(3, "0")}|`);
  const expectedReasoning = reasoningFragments.join(""), expectedText = textFragments.join("");
  const providerDeltas: ProviderDelta[] = [], frontendDeltas: Delta[] = [];
  let providerStarted: Stamp | undefined, providerFinished: Stamp | undefined, frontendDone: Stamp | undefined, headersReceived: Stamp | undefined;
  let providerCalls = 0, modelRequest: { model?: string; reasoning_effort?: unknown; stream?: boolean } | undefined;
  let cookie = "", owner = "", org = "", agentUser = "", threadId = "";
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 2 });
  const fixture = createServer(async (incoming, outgoing) => {
    try {
      let raw = "";
      for await (const bytes of incoming) { raw += bytes;if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Fixture request too large"); }
      assert.match(incoming.headers.authorization || "", /^Bearer \S+$/);
      const body = JSON.parse(raw) as { model?: string; reasoning_effort?: unknown; stream?: boolean };
      assert.equal(body.model, "fixture-native");assert.equal(body.stream, true);
      modelRequest = { model: body.model, reasoning_effort: body.reasoning_effort, stream: body.stream };
      providerCalls++;providerStarted = stamp();
      outgoing.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });outgoing.flushHeaders();
      const send = (delta: unknown, finish_reason: string | null = null) => {
        if (outgoing.destroyed) throw new Error("Fixture model connection closed");
        outgoing.write(`data: ${JSON.stringify({ id: `stream-${marker}`, object: "chat.completion.chunk", created: 1,
          model: "fixture-native", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      };
      send({ role: "assistant" });
      for (const [index, delta] of reasoningFragments.entries()) {
        providerDeltas.push({ ...stamp(), type: "reasoning", index, delta });send({ reasoning_content: delta });await delay(fragmentDelayMs);
      }
      for (const [index, delta] of textFragments.entries()) {
        providerDeltas.push({ ...stamp(), type: "text", index, delta });send({ content: delta });await delay(fragmentDelayMs);
      }
      send({}, "stop");
      outgoing.once("finish", () => { providerFinished = stamp(); });
      outgoing.end("data: [DONE]\n\n");
    } catch {
      if (!outgoing.headersSent) { outgoing.writeHead(500);outgoing.end("Local streaming fixture rejected request"); }
      else outgoing.destroy();
    }
  });
  // No provider is started unless this explicit live test is requested.
  await new Promise<void>(resolve => fixture.listen(18973, "0.0.0.0", resolve));
  const request = (path: string, init: RequestInit = {}) => fetch(`${origin}/api${path}`, {
    ...init, headers: { Origin: origin, Cookie: cookie, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(100_000),
  });
  const updateCookies = (response: Response) => {
    const jar = new Map(cookie.split("; ").filter(Boolean).map(value => [value.slice(0, value.indexOf("=")), value.slice(value.indexOf("=") + 1)]));
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], separator = pair.indexOf("=");jar.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  };
  const json = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await request(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    updateCookies(response);const text = await response.text();assert(response.ok, `${path}: ${response.status} ${text.slice(0, 500)}`);return JSON.parse(text) as T;
  };
  const waitFor = async (ready: () => Promise<boolean>, label: string, timeout = 100_000) => {
    const deadline = Date.now() + timeout;
    do { if (await ready().catch(() => false)) return;await delay(300); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  };
  try {
    await waitFor(async () => {
      const status = await json<{ mode: string; harnesses: { id: string; provider?: string; defaultModel: string; available: boolean }[] }>("/chat/status");
      return status.mode === "live" && status.harnesses.some(harness => harness.id === "pi" && harness.available && harness.provider === "pi" && harness.defaultModel === "fixture-native");
    }, "explicit local fixture-native model configuration");
    const signup = await json<{ user: { id: string } }>("/auth/sign-up/email", { email: `cf-stream-${marker}@local.test`, name: `CF stream ${marker}`, password: `Fixture-${marker}!` });owner = signup.user.id;
    let me = await json<{ organization: { id: string } | null }>("/members/me");
    if (!me.organization) {
      const created = await json<{ id: string }>("/auth/organization/create", { name: `CF stream ${marker}`, slug: `cf-stream-${marker}` });org = created.id;
      await json("/auth/organization/set-active", { organizationId: org });me = await json<typeof me>("/members/me");
    }
    assert(me.organization?.id);org = me.organization.id;
    const agent = await json<{ member: { id: string; userId: string } }>("/members/agents", { name: `Stream ${marker}`, persona: { defaultHarness: "pi", defaultModel: "fixture-native", runtime: "local", skillNames: [] } });agentUser = agent.member.userId;
    threadId = (await json<{ id: string }>("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agent.member.id })).id;
    const submitted = stamp();
    const response = await request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: threadId,
      context: { page: "ai" }, agentId: agent.member.id, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: `Stream reasoning and then text for ${marker}.` }] }] }) });
    headersReceived = stamp();
    assert.equal(response.status, 200);assert(response.body);
    const reader = response.body.getReader(), decoder = new TextDecoder();let buffer = "", sawDone = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const separator = buffer.indexOf("\n\n");if (separator < 0) break;
          const event = buffer.slice(0, separator);buffer = buffer.slice(separator + 2);
          const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data === "[DONE]") { sawDone = true;continue; }
          if (!data) continue;
          const chunk = JSON.parse(data) as { type: string; id?: string; delta?: string; errorText?: string };
          assert.notEqual(chunk.type, "error", chunk.errorText);
          if (chunk.type === "reasoning-delta" || chunk.type === "text-delta") {
            assert.equal(typeof chunk.delta, "string");
            const cursor = /^id:\s*(\d+)$/m.exec(event);
            frontendDeltas.push({ ...stamp(), type: chunk.type, id: chunk.id ?? "", delta: chunk.delta!, cursor: cursor ? Number(cursor[1]) : null });
          }
        }
      }
      frontendDone = stamp();
    } finally { reader.releaseLock(); }
    assert(headersReceived.monotonicMs - submitted.monotonicMs < 3000, "SSE acknowledgement must not wait for the cold SDK import");
    assert(sawDone);assert.equal(buffer.trim(), "");assert.equal(providerCalls, 1);assert(providerStarted);assert(providerFinished);
    const reasoning = frontendDeltas.filter(delta => delta.type === "reasoning-delta"), text = frontendDeltas.filter(delta => delta.type === "text-delta");
    const { runs } = await json<{ runs: { id: string; assistantMessageId: string; status: string }[] }>(`/threads/${threadId}/runs`);
    assert.equal(runs.length, 1);assert.equal(runs[0].status, "completed");
    const [stored] = await resource.db.select({ content: chatMessages.content }).from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.messageId, runs[0].assistantMessageId)));
    const parts = stored.content.parts as { type: string; text?: string }[];
    const persistedReasoning = parts.filter(part => part.type === "reasoning").map(part => part.text ?? "").join("");
    const persistedText = parts.filter(part => part.type === "text").map(part => part.text ?? "").join("");
    const chunks = await resource.db.select({ cursor: agentExecutionChunks.cursor, chunk: agentExecutionChunks.chunk }).from(agentExecutionChunks)
      .innerJoin(agentExecutions, eq(agentExecutions.id, agentExecutionChunks.executionId)).where(eq(agentExecutions.runId, runs[0].id)).orderBy(agentExecutionChunks.cursor);
    const [execution] = await resource.db.select({ id: agentExecutions.id }).from(agentExecutions).where(eq(agentExecutions.runId, runs[0].id));
    const frontendFinishedLagMs = frontendDone.monotonicMs - providerFinished.monotonicMs;
    const perFragmentLags = providerDeltas.map(fragment => {
      const delivered = frontendDeltas.find(delta => delta.type === (fragment.type === "reasoning" ? "reasoning-delta" : "text-delta") && delta.delta.includes(fragment.delta));
      return delivered ? delivered.monotonicMs - fragment.monotonicMs : null;
    });
    let gatewayRequests: { action: string; chunks?: number }[] | null = null;
    const logPath = process.env.TABDO_CF_STREAMING_GATEWAY_LOG;
    if (logPath) {
      gatewayRequests = (await readFile(logPath, "utf8")).split("\n").flatMap(line => {
        try { const event = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1));return event.event === "agent.gateway.request" && event.executionId === execution.id ? [{ action: String(event.action), chunks: typeof event.chunks === "number" ? event.chunks : undefined }] : []; }
        catch { return []; }
      });
      assert(gatewayRequests.length, "configured gateway metrics log must contain this execution; chunk rows are not HTTP request counts");
    }
    const report = {
      marker, executionId: execution.id, note: "Local fixture over Vite→Worker→DO→Docker Pi→PostgreSQL→SSE. No Vercel measurement; cold start excluded from output lag.",
      configuration: { reasoningFragments: 80, textFragments: 160, fragmentDelayMs, modelRequest },
      summary: { submitToModelMs: providerStarted.monotonicMs - submitted.monotonicMs,
        submitToHeadersMs: headersReceived.monotonicMs - submitted.monotonicMs,
        headersToModelMs: providerStarted.monotonicMs - headersReceived.monotonicMs,
        modelSendingMs: providerFinished.monotonicMs - providerStarted.monotonicMs, frontendFinishedLagMs,
        firstReasoningFromProviderMs: reasoning[0] ? reasoning[0].monotonicMs - providerStarted.monotonicMs : null,
        firstTextFromProviderMs: text[0] ? text[0].monotonicMs - providerStarted.monotonicMs : null,
        deliveredReasoningDeltas: reasoning.length, deliveredTextDeltas: text.length, persistedChunks: chunks.length,
        gatewayRequests: gatewayRequests?.length ?? null, gatewayActionCounts: gatewayRequests ? Object.fromEntries([...new Set(gatewayRequests.map(event => event.action))].map(action => [action, gatewayRequests!.filter(event => event.action === action).length])) : null,
        fragmentDeliveryP50Ms: percentile(perFragmentLags.filter((value): value is number => value !== null), 0.5), fragmentDeliveryP95Ms: percentile(perFragmentLags.filter((value): value is number => value !== null), 0.95) },
      timestamps: { submitted, headersReceived, providerStarted, providerFinished, frontendDone }, providerDeltas, frontendDeltas, perFragmentLags,
      persisted: { reasoning: persistedReasoning, text: persistedText },
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    traceWritten = true;
    console.info("CF streaming measured:", JSON.stringify(report.summary));console.info("CF streaming trace:", reportPath);
    assert.equal(reasoning.map(delta => delta.delta).join(""), expectedReasoning, "frontend reasoning has neither missing nor duplicate fragments");
    assert.equal(text.map(delta => delta.delta).join(""), expectedText, "frontend text has neither missing nor duplicate fragments");
    assert.equal(persistedReasoning, expectedReasoning);assert.equal(persistedText, expectedText);
    assert(reasoning[0].monotonicMs < text[0].monotonicMs, "reasoning is consumed before body text");
    assert(reasoning[0].monotonicMs < providerFinished.monotonicMs, "reasoning arrives while the provider is still streaming");
    assert.deepEqual(chunks.map(chunk => chunk.cursor), chunks.map((_chunk, index) => index + 1));
    const cursors = frontendDeltas.map(delta => delta.cursor).filter((cursor): cursor is number => cursor !== null);
    assert.equal(new Set(cursors).size, cursors.length, "frontend receives each durable delta cursor once");
    // Optional operator-selected budget; the default reports local measurement without inventing a target.
    if (process.env.TABDO_CF_STREAM_MAX_LAG_MS) assert(frontendFinishedLagMs <= Number(process.env.TABDO_CF_STREAM_MAX_LAG_MS), "configured post-provider SSE completion budget");
  } finally {
    if (!traceWritten) {
      await writeFile(reportPath, `${JSON.stringify({ marker, partial: true, providerCalls, modelRequest,
        timestamps: { headersReceived, providerStarted, providerFinished, frontendDone }, providerDeltas, frontendDeltas }, null, 2)}\n`, "utf8").catch(() => {});
      console.info("CF streaming partial trace:", reportPath);
    }
    if (threadId) {
      const history = await json<{ runs: { id: string; status: string }[] }>(`/threads/${threadId}/runs`).catch(() => ({ runs: [] }));
      for (const run of history.runs.filter(run => ["starting", "running"].includes(run.status)))
        await request(`/threads/${threadId}/runs/${run.id}/cancel`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
      await request(`/threads/${threadId}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
    fixture.closeAllConnections();await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (org) {
      const [owned] = await resource.db.select({ id: organization.id }).from(organization).innerJoin(member, eq(member.organizationId, organization.id)).where(and(eq(organization.id, org), eq(member.userId, owner), eq(member.role, "owner")));
      if (owned) await resource.db.delete(organization).where(eq(organization.id, org));
    }
    for (const id of [agentUser, owner].filter(Boolean)) await resource.db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});
