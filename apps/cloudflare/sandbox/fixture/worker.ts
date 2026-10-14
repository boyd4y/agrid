import { DurableObject } from "cloudflare:workers";

type Checkpoint = { protocol: 1; sessionId: string; resumeState: unknown; workspace: unknown[] };
type CheckpointEvent = { type: "checkpoint"; checkpoint: Checkpoint; toolsExecuted: number; providerCalls: number; marker: string };
type CompletedEvent = { type: "completed"; text: string; toolsExecuted: number; marker: string; providerCalls: number; nativeAnswer: unknown };

/** Isolated local lifecycle fixture. Production checkpoints remain authoritative in PG/R2. */
export class NativeHarnessContainer extends DurableObject<NativeSandboxFixtureEnv> {
  fixtureIdentity() { return this.ctx.id.toString(); }
  async run(mode: "produce" | "consume", sessionId: string) {
    const container = this.ctx.container;
    if (!container) throw new Error("The actual container binding is required");
    if (!container.running) container.start({ image: container.images.runner, enableInternet: false, entrypoint: ["sleep", "infinity"] });
    await container.setInactivityTimeout(60_000);
    const checkpoint = mode === "consume" ? await this.ctx.storage.get<Checkpoint>("checkpoint") : undefined;
    if (mode === "consume" && (!checkpoint || checkpoint.sessionId !== sessionId)) throw new Error("Native checkpoint is missing");
    const stdin = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ sessionId, checkpoint })));controller.close();
    } });
    // Resource readiness is not a business acceptance receipt. exec starts finite
    // compute; HTTP disconnect is deliberately not passed as its abort signal.
    const process = await container.exec(["node", "--conditions=development", "--import", "tsx", "/opt/tabdo/sandbox/native-entry.ts", mode], { cwd: "/opt/tabdo/sandbox", stdin });
    const output = await process.output();
    const stdout = new TextDecoder().decode(output.stdout), stderr = new TextDecoder().decode(output.stderr);
    if (stdout.length > 2 * 1024 * 1024 || stderr.length > 64 * 1024) throw new Error("Fixture output exceeded its bounded limit");
    if (output.exitCode !== 0) throw new Error(`Native fixture exited ${output.exitCode}: ${stderr.slice(-12000)}`);
    const events = stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line) as { type: string });
    const boot = events.find(event => event.type === "resource-ready");
    if (!boot) throw new Error("Native resource boot acknowledgement is missing");
    if (mode === "produce") {
      const saved = events.find(event => event.type === "checkpoint") as CheckpointEvent | undefined;
      if (!saved || saved.marker !== "1" || saved.toolsExecuted !== 1) throw new Error("Real native tool/checkpoint was not produced");
      await this.ctx.storage.put("checkpoint", saved.checkpoint);
      await container.destroy();
      return { mode, boot, checkpointSaved: true, actualContainerDestroyed: !container.running, marker: saved.marker, toolsExecuted: saved.toolsExecuted, providerCalls: saved.providerCalls };
    }
    const completed = events.find(event => event.type === "completed") as CompletedEvent | undefined;
    if (!completed || completed.marker !== "1" || completed.toolsExecuted !== 0) throw new Error("Native cold continuation replayed a tool");
    await container.destroy();await this.ctx.storage.delete("checkpoint");
    return { mode, boot, ...completed, actualContainerDestroyed: !container.running };
  }
  async destroyFixture() { await this.ctx.container?.destroy();await this.ctx.storage.deleteAll(); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), sessionId = url.searchParams.get("sessionId") ?? "";
    if (!/^[a-z0-9-]{1,100}$/.test(sessionId)) return new Response("Invalid fixture session ID", { status: 400 });
    const sandbox = env.NATIVE_SANDBOX.getByName(sessionId);
    if (url.pathname === "/identity") return Response.json({ id: await sandbox.fixtureIdentity() });
    if (url.pathname === "/destroy") { await sandbox.destroyFixture();return Response.json({ destroyed: true }); }
    if (url.pathname !== "/produce" && url.pathname !== "/consume") return new Response("Not found", { status: 404 });
    return Response.json(await sandbox.run(url.pathname === "/produce" ? "produce" : "consume", sessionId));
  },
} satisfies ExportedHandler<NativeSandboxFixtureEnv>;
