import { posix } from "node:path";
import { Sandbox, SandboxFileNotFoundError, type CreateOptions, type ExecHandle } from "railway";
import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import { SandboxConfigurationError, SandboxCleanupError, type SandboxAdapter } from "./types.js";

type Files = ReturnType<HarnessV1NetworkSandboxSession["restricted"]>;

/** Railway has connect/destroy, but no pause. stop closes owned execs, preserving the live VM until its idle timeout. */
export function createRailwaySandboxAdapter(options: { token: string; environmentId: string; ports?: number[]; idleTimeoutMinutes?: number; region?: string; checkpoint?: string }): SandboxAdapter {
  const ports = [...(options.ports ?? [4000])];
  const connection = { token: options.token, environmentId: options.environmentId };
  const wrap = async (native: Sandbox, signal?: AbortSignal): Promise<HarnessV1NetworkSandboxSession> => {
    signal?.throwIfAborted();
    const pwd = await native.exec("pwd", { signal, ephemeral: true });
    if (pwd.exitCode !== 0 || !posix.isAbsolute(pwd.stdout.trim())) throw new Error("Cannot resolve Railway sandbox working directory");
    signal?.throwIfAborted();
    const cwd = pwd.stdout.trim(), processes = new Set<ExecHandle>();
    let stopped = false, destroyed = false;
    const active = (signal?: AbortSignal) => { signal?.throwIfAborted();if (stopped || destroyed) throw new Error("Railway sandbox session is stopped"); };
    const path = (value: string) => posix.resolve(cwd, value);
    const files: Files = {
      description: `Railway Linux sandbox ${native.id}; files persist until the VM is destroyed or expires.`,
      async readFile(settings) {
        active(settings.abortSignal);
        try { await native.files.stat(path(settings.path)); }
        catch (error) { if (error instanceof SandboxFileNotFoundError) return null;throw error; }
        active(settings.abortSignal);
        const stream = await native.files.read(path(settings.path), { format: "stream" });
        return settings.abortSignal ? stream.pipeThrough(new TransformStream(), { signal: settings.abortSignal }) : stream;
      },
      async readBinaryFile(settings) {
        const stream = await files.readFile(settings);
        return stream === null ? null : new Uint8Array(await new Response(stream).arrayBuffer());
      },
      async readTextFile(settings) {
        const bytes = await files.readBinaryFile(settings);
        if (bytes === null) return null;
        const text = new TextDecoder(settings.encoding ?? "utf-8").decode(bytes);
        if (settings.startLine === undefined && settings.endLine === undefined) return text;
        const ending = text.includes("\r\n") ? "\r\n" : text.includes("\n") ? "\n" : text.includes("\r") ? "\r" : "\n";
        return text.split(ending).slice(Math.max(1, settings.startLine ?? 1) - 1, settings.endLine).join(ending);
      },
      async writeFile(settings) {
        active(settings.abortSignal);
        const stream = settings.abortSignal ? settings.content.pipeThrough(new TransformStream(), { signal: settings.abortSignal }) : settings.content;
        await native.files.write(path(settings.path), stream);
        settings.abortSignal?.throwIfAborted();
      },
      async writeBinaryFile(settings) {
        await files.writeFile({ ...settings, content: new Blob([new Uint8Array(settings.content)]).stream() });
      },
      async writeTextFile(settings) {
        if (!Buffer.isEncoding(settings.encoding ?? "utf8")) throw new Error("Unsupported file encoding");
        await files.writeBinaryFile({ ...settings, content: Buffer.from(settings.content, (settings.encoding ?? "utf8") as BufferEncoding) });
      },
      async spawn(settings) {
        active(settings.abortSignal);
        let stdout!: ReadableStreamDefaultController<Uint8Array>, stderr!: ReadableStreamDefaultController<Uint8Array>;
        const encoder = new TextEncoder();
        const out = new ReadableStream<Uint8Array>({ start(controller) { stdout = controller; } });
        const err = new ReadableStream<Uint8Array>({ start(controller) { stderr = controller; } });
        const handle = native.exec(settings.command, { cwd: settings.workingDirectory ?? cwd, env: settings.env,
          signal: settings.abortSignal, captureOutput: false, ephemeral: true,
          onStdout: chunk => stdout.enqueue(encoder.encode(chunk)), onStderr: chunk => stderr.enqueue(encoder.encode(chunk)) });
        processes.add(handle);
        const complete = Promise.resolve(handle).then(result => ({ exitCode: result.exitCode ?? 128 }));
        void complete.finally(() => { processes.delete(handle);stdout.close();stderr.close(); }).catch(() => {});
        void complete.catch(() => {});
        let killing: Promise<void> | undefined;
        return { stdout: out, stderr: err, wait: () => complete,
          kill: () => killing ??= (async () => { if (processes.has(handle)) await handle.kill("KILL");await complete.catch(() => {}); })() };
      },
      async run(settings) {
        const child = await files.spawn(settings);
        const [stdout, stderr, result] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.wait()]);
        return { ...result, stdout, stderr };
      },
    };
    // Keep a VM alive during model waits. No heartbeat remains after stop/destroy.
    const heartbeat = setInterval(() => { void native.heartbeat().catch(() => {}); }, 30_000);
    heartbeat.unref();
    const stop = async () => {
      clearInterval(heartbeat);
      stopped = true;
      await Promise.all([...processes].map(async handle => { await handle.kill("KILL");await Promise.resolve(handle).catch(() => {}); }));
    };
    const getPortEndpoint: HarnessV1NetworkSandboxSession["getPortEndpoint"] = async ({ port, protocol }) => {
      active();
      const domain = native.domains.find(entry => entry.port === port)?.domain;
      if (!ports.includes(port) || !domain) throw new SandboxConfigurationError(`Railway port ${port} has no published domain`);
      return { url: `${protocol === "ws" ? "wss" : "https"}://${domain}` };
    };
    return { ...files, id: native.id, defaultWorkingDirectory: cwd, ports, getPortEndpoint,
      getPortUrl: async settings => (await getPortEndpoint(settings)).url, restricted: () => Object.freeze({ ...files }), stop,
      destroy: async () => {
        if (destroyed) return;
        try { await stop(); }
        finally { await native.destroy();destroyed = true; }
      } };
  };
  return { networkAccessible: true,
    async create(request = {}) {
      request.abortSignal?.throwIfAborted();
      if (request.sandboxId) throw new SandboxConfigurationError("Railway assigns sandbox IDs; create cannot accept a sandboxId");
      const settings: CreateOptions = { ...connection, networkIsolation: "PRIVATE", domains: ports.map(port => ({ port })),
        idleTimeoutMinutes: options.idleTimeoutMinutes, region: options.region };
      // Railway create has no AbortSignal. Await acquisition before cancellation
      // cleanup so a late-created VM can never become an untracked orphan.
      const native = options.checkpoint ? await Sandbox.create(options.checkpoint, settings) : await Sandbox.create(settings);
      let session: HarnessV1NetworkSandboxSession | undefined;
      try {
        session = await wrap(native, request.abortSignal);
        await request.template?.prepare({ session: session.restricted(), abortSignal: request.abortSignal });
        request.abortSignal?.throwIfAborted();
        return { session };
      } catch (error) {
        try { if (session) await session.destroy();else await native.destroy(); }
        catch (cleanup) { throw new SandboxCleanupError(native.id, error, cleanup); }
        throw error;
      }
    },
    async resume(request) {
      request.abortSignal?.throwIfAborted();
      const native = await Sandbox.connect(request.sandboxId, connection);
      if (native.status !== "RUNNING") throw new SandboxConfigurationError(`Railway sandbox ${native.id} is ${native.status}; resume requires RUNNING`);
      const session = await wrap(native, request.abortSignal);
      return { session };
    },
  };
}
