import { DurableObject } from "cloudflare:workers";
import { parseExecutionRequest, type ExecutionRequest, type ExecutionResource } from "@tabdo/core/execution";
import { parseExecutionSnapshot, type ExecutionSnapshot } from "@tabdo/core/transport/execution-http-host";

export type ContainerExecutionProgram = Readonly<{
  imageKey: string;
  entrypoint: readonly string[];
  command: readonly string[];
  enableInternet: boolean;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
}>;
export type ContainerExecutionOptions = Readonly<{ inactivityTimeoutMs?: number; startupTimeoutMs?: number }>;
export interface ContainerExecutionCallbacks<Env> {
  /** Must verify the caller's already-durable acceptance, never a principal from the reference. */
  verifyAccepted(env: Env, request: ExecutionRequest): Promise<void>;
  /** Supplies bounded control input/limited execution credentials, not tools or live closures. */
  prepare?(env: Env, request: ExecutionRequest, launchToken: string): Promise<Readonly<{ stdin?: string; env?: Readonly<Record<string, string>> }>>;
  /** Optional readonly reconciliation. Must bind observed status to this exact physical resource. */
  probe?(env: Env, resource: ExecutionResource, container: Container): Promise<ExecutionSnapshot | undefined>;
}
export interface ContainerExecutionRpc {
  startExecution(request: ExecutionRequest): Promise<ExecutionSnapshot>;
  lookupExecution(id: string): Promise<ExecutionSnapshot | undefined>;
  /** Application cancellation is persisted separately before calling resource termination. */
  terminateExecution(id: string): Promise<ExecutionSnapshot | undefined>;
}
export type ContainerExecutionClass<Env> = new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & ContainerExecutionRpc;

type ResourceRow = {
  resource_id: string; reference_hash: string; launch_token: string; pid: number | null;
  phase: "launching" | "running" | "exited" | "unknown" | "terminating"; exit_code: number | null; exit_signal: string | null;
};

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left],[right]) => left.localeCompare(right))) : item);
}
function validateId(id: string): void {
  if (typeof id !== "string" || !id.trim() || id.length > 200) throw new TypeError("Invalid execution id");
}

/** Dedicated DO/container per resource. The launch fence is provider metadata, never business state. */
export function createContainerExecutionObject<Env>(
  configure: (env: Env) => ContainerExecutionProgram,
  callbacks: ContainerExecutionCallbacks<Env>,
  options: ContainerExecutionOptions = {},
): ContainerExecutionClass<Env> {
  const inactivityMs = options.inactivityTimeoutMs ?? 900000;
  const startupMs = options.startupTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1 || inactivityMs > 21600000
    || !Number.isSafeInteger(startupMs) || startupMs < 1 || startupMs > 300000) throw new TypeError("Invalid container lifecycle bounds");

  return class ContainerExecutionObject extends DurableObject<Env> implements ContainerExecutionRpc {
    #process?: ExecProcess;
    #boot?: Promise<ExecutionSnapshot>;
    #startup?: AbortController;
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS execution_resource (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), resource_id TEXT NOT NULL, reference_hash TEXT NOT NULL,
        launch_token TEXT NOT NULL, pid INTEGER, phase TEXT NOT NULL, exit_code INTEGER, exit_signal TEXT
      )`);
      if (!this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(execution_resource)").toArray().some(column => column.name === "exit_signal")) {
        this.ctx.storage.sql.exec("ALTER TABLE execution_resource ADD COLUMN exit_signal TEXT");
      }
      const container = this.ctx.container;
      if (container?.running) this.ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(inactivityMs));
    }

    #row(): ResourceRow | undefined {
      return this.ctx.storage.sql.exec<ResourceRow>("SELECT resource_id,reference_hash,launch_token,pid,phase,exit_code,exit_signal FROM execution_resource WHERE singleton=1").toArray()[0];
    }
    #owned(id: string): ResourceRow | undefined {
      validateId(id);
      const row = this.#row();
      if (row && row.resource_id !== id) throw new Error("Execution resource identity cannot change");
      return row;
    }
    #resource(row: ResourceRow): ExecutionResource {
      return { id: row.resource_id, provider: "cloudflare-container", reference: `${this.ctx.id.toString()}/${row.launch_token}/${row.pid ?? "unconfirmed"}` };
    }
    #snapshot(row: ResourceRow): ExecutionSnapshot {
      return { resource: this.#resource(row), state: row.phase === "exited" ? "exited" : row.phase === "running" ? "running" : "unknown",
        ...(row.phase === "exited" ? { exit: { code: row.exit_code, signal: row.exit_signal } } : {}) };
    }
    #unknown(): ExecutionSnapshot {
      this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='unknown' WHERE singleton=1 AND phase!='exited'");
      return this.#snapshot(this.#row()!);
    }

    async #launch(request: ExecutionRequest, token: string): Promise<ExecutionSnapshot> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const program = configure(this.env);
        if (!program.imageKey || !program.command.length || !program.entrypoint.length
          || program.command.some(item => !item || item.includes("\0")) || program.entrypoint.some(item => !item || item.includes("\0"))) throw new TypeError("Invalid trusted container program");
        const prepared = await callbacks.prepare?.(this.env, request, token);
        // Termination may have arrived while acceptance preparation was awaiting its gateway.
        if (this.#row()?.phase !== "launching") return this.#snapshot(this.#row()!);
        const input = prepared?.stdin ?? JSON.stringify({ id: request.id, reference: request.reference, launchToken: token });
        const bytes = new TextEncoder().encode(input);
        if (bytes.byteLength > 131072) throw new Error("Container control input exceeds bounds");
        const container = this.ctx.container;
        if (!container) throw new Error("Container binding is required");
        // A pre-existing container without this launch's marker cannot be adopted as unused compute.
        if (container.running) throw new Error("Unowned container is already running");
        const image = container.images[program.imageKey];
        if (!image) throw new Error("Configured container image is missing");
        container.start({ image, enableInternet: program.enableInternet, entrypoint: [...program.entrypoint], labels: { launch: token } });
        await container.setInactivityTimeout(inactivityMs);
        if (this.#row()?.phase !== "launching") {
          await container.destroy();
          return this.#snapshot(this.#row()!);
        }
        const stdin = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes);controller.close(); } });
        const abort = new AbortController();
        this.#startup = abort;
        timer = setTimeout(() => abort.abort(), startupMs);
        // No request.signal forwarding. exec() waits for container readiness and acknowledges process spawn only.
        const process = await container.exec([...program.command], { cwd: program.cwd, env: { ...program.env, ...prepared?.env },
          stdin, stdout: "ignore", stderr: "ignore", signal: abort.signal });
        clearTimeout(timer);timer = undefined;
        if (this.#row()?.phase !== "launching") {
          await container.destroy();
          return this.#snapshot(this.#row()!);
        }
        this.#process = process;
        this.ctx.storage.sql.exec("UPDATE execution_resource SET pid=?,phase='running' WHERE singleton=1 AND launch_token=?", process.pid, token);
        // Observation can disappear on DO eviction. Never keep a whole turn alive with waitUntil.
        void process.exitCode.then(code => {
          this.#process = undefined;
          this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='exited',exit_code=?,exit_signal=NULL WHERE singleton=1 AND launch_token=?", code, token);
        }, () => {
          this.#process = undefined;
          this.#unknown();
        }).catch(() => { /* An evicted DO cannot write metadata; reconciliation remains explicit. */ });
        return this.#snapshot(this.#row()!);
      } catch {
        this.#unknown();
        // Fail closed even when preparation or exec failed: no retry may infer the command never started.
        throw new Error("Container launch is unconfirmed; reconcile this resource without replaying it");
      } finally { if (timer !== undefined) clearTimeout(timer);this.#startup = undefined; }
    }

    async startExecution(input: ExecutionRequest): Promise<ExecutionSnapshot> {
      const parsed = parseExecutionRequest(input);
      const referenceJson = canonical(parsed.reference);
      const request = { id: parsed.id, reference: JSON.parse(referenceJson) as ExecutionRequest["reference"] };
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(referenceJson)));
      const hash = Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
      await callbacks.verifyAccepted(this.env, request);
      const previous = this.#owned(request.id);
      if (previous) {
        if (previous.reference_hash !== hash) throw new Error("Accepted execution reference cannot change");
        if (this.#boot) return this.#boot;
        return (await this.lookupExecution(request.id))!;
      }
      const token = crypto.randomUUID();
      // Synchronous SQLite commit precedes every external launch side effect.
      this.ctx.storage.sql.exec("INSERT INTO execution_resource(singleton,resource_id,reference_hash,launch_token,phase) VALUES(1,?,?,?,'launching')", request.id, hash, token);
      const boot = this.#launch(request, token);
      this.#boot = boot;
      try { return await boot; }
      finally { if (this.#boot === boot) this.#boot = undefined; }
    }

    async lookupExecution(id: string): Promise<ExecutionSnapshot | undefined> {
      const row = this.#owned(id);
      if (!row) return undefined;
      if (row.phase === "exited") return this.#snapshot(row);
      if (this.#boot) return this.#boot;
      if (this.#process) return this.#snapshot(row);
      const container = this.ctx.container;
      if (container?.running && callbacks.probe) {
        const information = await container.inspect();
        if (information?.labels.launch === row.launch_token) {
          const observed = await callbacks.probe(this.env, this.#resource(row), container);
          if (observed) {
            const snapshot = parseExecutionSnapshot(observed, row.resource_id);
            if (snapshot.resource.provider !== "cloudflare-container" || snapshot.resource.reference !== this.#resource(row).reference) throw new Error("Probe resource identity mismatch");
            if (snapshot.state === "exited") this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='exited',exit_code=?,exit_signal=? WHERE singleton=1 AND phase!='exited'", snapshot.exit!.code,snapshot.exit!.signal);
            else if (snapshot.state === "running") this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='running' WHERE singleton=1 AND phase!='exited'");
            return this.#row()?.phase === "exited" ? this.#snapshot(this.#row()!) : snapshot;
          }
        }
      }
      return this.#unknown();
    }

    async terminateExecution(id: string): Promise<ExecutionSnapshot | undefined> {
      const row = this.#owned(id);
      if (!row) return undefined;
      // Fence further launch work before asynchronous destruction, including a pending prepare/exec.
      this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='terminating' WHERE singleton=1 AND phase!='exited'");
      this.#startup?.abort();
      try { await this.ctx.container?.destroy(); }
      catch { this.#unknown();throw new Error("Container termination is unconfirmed"); }
      this.#process = undefined;
      // Destruction certifies compute is gone, not why it ended or whether business work committed.
      this.ctx.storage.sql.exec("UPDATE execution_resource SET phase='exited' WHERE singleton=1");
      return this.#snapshot(this.#row()!);
    }
  };
}
