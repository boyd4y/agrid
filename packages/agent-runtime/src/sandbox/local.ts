import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, lstat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import { DiskWorkspace, createDiskWorkspace } from "./workspace.js";
import { SandboxConfigurationError, type SandboxAdapter, type SandboxCreateOptions, type SandboxResumeOptions } from "./types.js";

type RestrictedSession = ReturnType<HarnessV1NetworkSandboxSession["restricted"]>;
type ProcessOptions = Parameters<RestrictedSession["spawn"]>[0];
type SandboxProcess = Awaited<ReturnType<RestrictedSession["spawn"]>>;
export type LocalSandboxAdapter = Omit<SandboxAdapter<DiskWorkspace>, "create" | "resume"> & {
  create(request?: SandboxCreateOptions): Promise<{ session: HarnessV1NetworkSandboxSession; workspace: DiskWorkspace }>;
  resume(request: SandboxResumeOptions): Promise<{ session: HarnessV1NetworkSandboxSession; workspace: DiskWorkspace }>;
};
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function localPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject);server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate local bridge port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

/** Real host/container execution. Directory checks are not an OS security boundary. */
export function createLocalSandboxAdapter(options: {
  cwd: string;
  env: Record<string, string>;
  /** Stable, caller-owned storage for runtimes whose installed dependencies cannot fit a JSON snapshot. */
  storageDirectory?: string;
  createFilesystem?: () => Promise<DiskWorkspace>;
  restoreFilesystem?: (reference: SandboxResumeOptions) => Promise<DiskWorkspace>;
}): LocalSandboxAdapter {
  const open = async (workspace: DiskWorkspace, request: SandboxCreateOptions, preserveOnFailure = false) => {
    request.abortSignal?.throwIfAborted();
    const workingDirectory = ["/", "/workspace", "/project"].includes(options.cwd)
      ? workspace.resolve(options.cwd.slice(1)) : workspace.resolve(options.cwd);
    await workspace.mkdir(workingDirectory, { recursive: true });
    await workspace.mkdir(".tmp", { recursive: true, mode: 0o700 });
    request.abortSignal?.throwIfAborted();
    const environment = { PATH: `${dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`, LANG: "C.UTF-8", ...options.env,
      HOME: workspace.root, TMPDIR: join(workspace.root, ".tmp") };
    // pnpm must not discover a host workspace above the owned HOME. Use its
    // public standalone option unless an owned workspace supplies the settings.
    // A manifest also bounds npm's project-config lookup from empty directories.
    try { await writeFile(workspace.checked("package.json"), '{"private":true}\n', { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const toolsDirectory = join(workspace.root, ".local-tools");
    await workspace.mkdir(toolsDirectory, { recursive: true, mode: 0o700 });
    const pnpmPath = join(toolsDirectory, "pnpm");
    await workspace.writeFile(pnpmPath, `#!/bin/bash
export PATH=${shellQuote(environment.PATH)}
directory="$PWD"
projectDirectory=""
while [[ "$directory" == ${shellQuote(workspace.root)} || "$directory" == ${shellQuote(`${workspace.root}/`)}* ]]; do
  if [ -f "$directory/pnpm-workspace.yaml" ]; then exec pnpm "$@"; fi
  if [ -z "$projectDirectory" ] && { [ -f "$directory/package.json" ] || [ -f "$directory/package.yaml" ] || [ -f "$directory/package.json5" ]; }; then projectDirectory="$directory"; fi
  directory="\${directory%/*}"
done
exec pnpm --dir "\${projectDirectory:-$PWD}" --ignore-workspace "$@"
`, { mode: 0o700 });
    await workspace.chmod(pnpmPath, 0o700);
    environment.PATH = `${toolsDirectory}:${environment.PATH}`;
    const processes = new Set<{ child: ChildProcess; kill(): Promise<void> }>();
    let stopped = false;
    // A creator signal ends when create/resume returns. Later SDK cleanup must
    // still be able to write its journal without the cancelled turn signal.
    const active = (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (stopped) throw new Error("Local execution session is stopped");
    };
    const file = (path: string) => workspace.checked(isAbsolute(path) ? path : join(workingDirectory, path));
    const spawn = async (settings: ProcessOptions): Promise<SandboxProcess> => {
      active(settings.abortSignal);
      const cwd = settings.workingDirectory ? file(settings.workingDirectory) : workingDirectory;
      const signal = settings.abortSignal;
      // No host environment is inherited. stdin is EOF: the SDK process contract
      // exposes output streams and cancellation, but has no stdin writer.
      const child = spawnChild("/bin/bash", ["--noprofile", "--norc", "-c", settings.command], {
        cwd, env: { ...environment, ...settings.env, HOME: workspace.root, TMPDIR: join(workspace.root, ".tmp") },
        stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
      });
      let terminate: Promise<void> | undefined, processEnded = false, groupKilled = false, processClosed = false;
      let failed = false, cancelled = false, abortReason: unknown;
      let rejectFailure: (error: unknown) => void = () => {};
      const failure = new Promise<never>((_accept, reject) => { rejectFailure = reject; });
      const fail = (error: unknown) => { failed = true;rejectFailure(error); };
      const signalGroup = (name: NodeJS.Signals) => {
        if (!child.pid || processClosed || groupKilled) return;
        try {
          if (process.platform !== "win32") process.kill(-child.pid, name); else child.kill(name);
          // One successful group SIGKILL also covers descendants. Sending it
          // again on exit can hit a zombie-only group (EPERM on macOS).
          if (name === "SIGKILL") groupKilled = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") groupKilled = true;
          else fail(error);
        }
      };
      const closed = new Promise<{ exitCode: number }>(accept => {
        child.on("error", error => { if (!child.pid) processEnded = true;fail(error); });
        child.once("exit", () => { processEnded = true;signalGroup("SIGKILL"); });
        child.once("close", (code, exitSignal) => {
          processClosed = true;
          accept({ exitCode: code ?? (exitSignal ? 128 : 1) });
        });
      });
      // Callers may never wait on spawn. Retain rejection semantics without an
      // unhandled-rejection side effect while cleanup/cancellation owns it.
      const finished = Promise.race([closed, failure]);
      const complete = finished.then(result => { if (cancelled) throw abortReason;return result; });
      void complete.catch(() => {});
      const handle = { child, async kill() {
        if (!terminate) terminate = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          if (!processEnded && !processClosed) {
            signalGroup("SIGTERM");
            if (!failed) {
              timer = setTimeout(() => { if (!processEnded) signalGroup("SIGKILL"); }, 250);
              timer.unref();
            }
          }
          // Signalling is not completion: successful cancellation waits for
          // stdio close. Signal errors reject without claiming a live child died.
          try { await finished; } finally { clearTimeout(timer); }
        })();
        await terminate;
      } };
      processes.add(handle);
      const abort = () => {
        cancelled = true;
        abortReason = signal?.reason ?? new DOMException("Command aborted", "AbortError");
        void handle.kill().catch(fail);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      void closed.then(() => {
        // Retain failed cleanup for stop/destroy to report, even if nobody waits.
        if (!failed) processes.delete(handle);
        signal?.removeEventListener("abort", abort);
      });
      return { pid: child.pid, stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>, stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
        wait: () => complete, kill: () => handle.kill() };
    };
    const sessionFiles: RestrictedSession = {
      description: `Real Node filesystem and Bash processes in ${workingDirectory}. This is not OS isolation; local commands run with the current process permissions.`,
      async readFile(settings) {
        active(settings.abortSignal);
        const path = file(settings.path);
        try { await workspace.stat(path); } catch (error) { if (missing(error)) return null; throw error; }
        return Readable.toWeb(createReadStream(path, { signal: settings.abortSignal })) as ReadableStream<Uint8Array>;
      },
      async readBinaryFile(settings) {
        active(settings.abortSignal);
        try { return await workspace.readFileBuffer(file(settings.path), { signal: settings.abortSignal }); }
        catch (error) { if (missing(error)) return null; throw error; }
      },
      async readTextFile(settings) {
        const bytes = await sessionFiles.readBinaryFile(settings);
        if (bytes === null) return null;
        const text = new TextDecoder(settings.encoding ?? "utf-8").decode(bytes);
        if (settings.startLine === undefined && settings.endLine === undefined) return text;
        // Match the SDK extractLines helper: select one newline convention,
        // clamp ranges, and exclude the delimiter after the selected final line.
        const lineEnding = text.includes("\r\n") ? "\r\n" : text.includes("\n") ? "\n" : text.includes("\r") ? "\r" : "\n";
        const lines = text.split(lineEnding);
        const start = Math.max(1, settings.startLine ?? 1) - 1;
        const end = Math.min(lines.length, settings.endLine ?? lines.length);
        return lines.slice(start, end).join(lineEnding);
      },
      async writeFile(settings) {
        active(settings.abortSignal);
        const path = file(settings.path);
        await mkdir(workspace.checked(dirname(path)), { recursive: true });
        await pipeline(Readable.fromWeb(settings.content as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(workspace.checked(path)), { signal: settings.abortSignal });
      },
      async writeBinaryFile(settings) {
        active(settings.abortSignal);
        await workspace.writeFile(file(settings.path), settings.content, { signal: settings.abortSignal });
      },
      async writeTextFile(settings) {
        if (!Buffer.isEncoding(settings.encoding ?? "utf8")) throw new Error("Unsupported file encoding");
        await sessionFiles.writeBinaryFile({ ...settings, content: Buffer.from(settings.content, (settings.encoding ?? "utf8") as BufferEncoding) });
      },
      spawn,
      async run(settings) {
        const process = await spawn(settings);
        const [stdout, stderr, result] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.wait()]);
        return { ...result, stdout, stderr };
      },
    };
    const stop = async () => { stopped = true;await Promise.all([...processes].map(process => process.kill())); };
    const ports = [await localPort()];
    const getPortEndpoint: HarnessV1NetworkSandboxSession["getPortEndpoint"] = async ({ port, protocol = "http" }) => {
      active();
      if (!ports.includes(port)) throw new SandboxConfigurationError(`Local port ${port} is not assigned to this session`);
      if (protocol === "https") throw new SandboxConfigurationError("Local bridge endpoints use loopback HTTP/WS without TLS");
      return { url: `${protocol === "ws" ? "ws" : "http"}://127.0.0.1:${port}` };
    };
    const session: HarnessV1NetworkSandboxSession = { ...sessionFiles, id: request.sandboxId ?? randomUUID(), defaultWorkingDirectory: workingDirectory,
      ports, getPortEndpoint, getPortUrl: async settings => (await getPortEndpoint(settings)).url,
      restricted: () => Object.freeze({ ...sessionFiles }), stop, destroy: async () => { await stop();await workspace.dispose(); },
    };
    try {
      await request.template?.prepare({ session: session.restricted(), abortSignal: request.abortSignal });
      request.abortSignal?.throwIfAborted();
      return { session, workspace };
    } catch (error) { if (preserveOnFailure) await session.stop();else await session.destroy();throw error; }
  };
  return { networkAccessible: true,
    async create(request = {}) {
      request.abortSignal?.throwIfAborted();
      const sandboxId = request.sandboxId ?? randomUUID();
      let workspace: DiskWorkspace;
      if (options.storageDirectory) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(sandboxId)) throw new SandboxConfigurationError("Invalid local sandbox ID");
        await mkdir(options.storageDirectory, { recursive: true, mode: 0o700 });
        const directory = join(options.storageDirectory, sandboxId);
        await mkdir(directory, { mode: 0o700 }); // EEXIST is a create conflict, never resume.
        workspace = new DiskWorkspace(directory);
      } else workspace = await (options.createFilesystem?.() ?? createDiskWorkspace());
      try { return await open(workspace, { ...request, sandboxId }); } catch (error) { await workspace.dispose();throw error; }
    },
    async resume(request) {
      request.abortSignal?.throwIfAborted();
      let workspace: DiskWorkspace;
      if (options.storageDirectory) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(request.sandboxId)) throw new SandboxConfigurationError("Invalid local sandbox ID");
        const directory = join(options.storageDirectory, request.sandboxId);
        if (!(await lstat(directory)).isDirectory()) throw new SandboxConfigurationError("Local sandbox directory is missing or invalid");
        workspace = new DiskWorkspace(directory);
        // A failed attach never owns destruction of an existing directory.
        return open(workspace, request, true);
      }
      if (!options.restoreFilesystem) throw new SandboxConfigurationError("Local resume requires a persisted workspace restorer");
      workspace = await options.restoreFilesystem(request);
      try { return await open(workspace, request); } catch (error) { await workspace.dispose();throw error; }
    },
  };
}
