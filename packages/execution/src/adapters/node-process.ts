import { spawn, type ChildProcess } from "node:child_process";
import { parseExecutionRequest, type ExecutionAdapter, type ExecutionExit, type ExecutionHandle, type ExecutionRequest } from "../index.js";

export type NodeProcessOptions = {
  executable: string;
  args: readonly string[];
  cwd: string;
  /** Explicit trusted control-process configuration. No ambient environment copying. */
  env: Readonly<Record<string, string>>;
  startupTimeoutMs?: number;
  terminateTimeoutMs?: number;
  onOutput?: (id: string, channel: "stdout" | "stderr", bytes: Uint8Array) => void;
};

/** Owns local computing handles only; durable start/retry fences belong to the caller. */
export function createNodeProcessExecution(options: NodeProcessOptions): ExecutionAdapter {
  if (!options.executable || !options.cwd) throw new TypeError("Execution command and cwd are required");
  const startupMs = options.startupTimeoutMs ?? 30_000, terminateMs = options.terminateTimeoutMs ?? 10_000;
  if (![startupMs, terminateMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError("Execution timeouts must be positive integers");
  const active = new Map<string, { input: string; pending: Promise<ExecutionHandle> }>();
  let closed = false;
  function launch(request: ExecutionRequest, remove: () => void): Promise<ExecutionHandle> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(options.executable, [...options.args], { cwd: options.cwd, env: { ...options.env }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      let acknowledged = false, exited = false, bootFailed = false;
      let finish!: (exit: ExecutionExit) => void;
      const completion = new Promise<ExecutionExit>(done => { finish = done; });
      let termination: Promise<ExecutionExit> | undefined;
      const handle: ExecutionHandle = {
        resource: { id: request.id, provider: "node-process", reference: String(child.pid ?? "unknown") },
        completion,
        terminate() {
          if (termination) return termination;
          if (exited) return completion;
          child.kill("SIGTERM");
          const hardStop = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, terminateMs);
          hardStop.unref();
          termination = completion.finally(() => clearTimeout(hardStop));
          return termination;
        },
      };
      const rejectBoot = (error: Error) => {
        if (acknowledged || bootFailed) return;
        bootFailed = true;
        void handle.terminate().then(() => reject(error));
      };
      const startup = setTimeout(() => rejectBoot(new Error(`Execution ${request.id} did not acknowledge resource startup`)), startupMs);
      startup.unref();
      child.stdout?.on("data", bytes => { try { options.onOutput?.(request.id, "stdout", bytes); } catch { /* Observation cannot stop computation. */ } });
      child.stderr?.on("data", bytes => { try { options.onOutput?.(request.id, "stderr", bytes); } catch { /* Observation cannot stop computation. */ } });
      child.on("message", message => {
        const value = message as { type?: unknown; id?: unknown } | null;
        if (acknowledged || bootFailed || value?.type !== "execution-ready" || value.id !== request.id) return;
        acknowledged = true;clearTimeout(startup);resolve(handle);
      });
      child.once("error", error => {
        clearTimeout(startup);
        if (child.pid === undefined) {
          reject(error);exited = true;finish({ code: null, signal: null });remove();
        } else {
          // An IPC/kill error does not establish that an already spawned
          // process exited. Keep ownership until its actual exit event.
          rejectBoot(error);
        }
      });
      child.once("exit", (code, signal) => {
        exited = true;clearTimeout(startup);remove();finish({ code, signal });
        if (!acknowledged) reject(new Error(`Execution ${request.id} exited before resource startup acknowledgement`));
      });
      child.once("spawn", () => {
        child.send({ type: "execution-start", request }, error => { if (error) rejectBoot(error); });
      });
    });
  }
  return {
    start(input) {
      if (closed) return Promise.reject(new Error("Execution adapter is closed"));
      const request = parseExecutionRequest(input);
      const previous = active.get(request.id);
      const referenceJson = JSON.stringify(request.reference);
      if (previous) return previous.input === referenceJson ? previous.pending : Promise.reject(new Error("Active execution reference cannot change"));
      const entry = { input: referenceJson, pending: undefined as unknown as Promise<ExecutionHandle> };
      const remove = () => { if (active.get(request.id) === entry) active.delete(request.id); };
      entry.pending = launch(request, remove);
      active.set(request.id, entry);
      void entry.pending.catch(remove);
      return entry.pending;
    },
    async lookup(id) { return active.get(id)?.pending; },
    async close() {
      closed = true;
      const handles = await Promise.allSettled([...active.values()].map(entry => entry.pending));
      await Promise.all(handles.flatMap(result => result.status === "fulfilled" ? [result.value.terminate()] : []));
    },
  };
}
