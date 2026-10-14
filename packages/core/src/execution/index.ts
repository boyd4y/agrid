/** JSON references locate trusted work. Never serialize closures into a launch request. */
export type ExecutionReference = null | boolean | number | string | readonly ExecutionReference[] | { readonly [key: string]: ExecutionReference };
export type ExecutionRequest = Readonly<{ id: string; reference: ExecutionReference }>;
export type ExecutionResource = Readonly<{ id: string; provider: string; reference: string }>;
export type ExecutionExit = Readonly<{ code: number | null; signal: string | null }>;
export interface ExecutionHandle {
  readonly resource: ExecutionResource;
  readonly completion: Promise<ExecutionExit>;
  /** Stops computing. Product cancellation must be persisted separately first. */
  terminate(): Promise<ExecutionExit>;
}
export interface ExecutionAdapter {
  /** Resource boot acknowledgement, not a durable application acceptance receipt. */
  start(request: ExecutionRequest): Promise<ExecutionHandle>;
  /** Undefined means this adapter cannot establish ownership, never proof of nonexecution. */
  lookup(id: string): Promise<ExecutionHandle | undefined>;
  close(): Promise<void>;
}
export function parseExecutionRequest(value: unknown): ExecutionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid execution request");
  const request = value as Record<string, unknown>;
  if (typeof request.id !== "string" || !request.id.trim() || request.id.length > 200 || !("reference" in request)) throw new TypeError("Invalid execution request");
  const validate = (item: unknown, depth: number): boolean => {
    if (depth > 20) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(child => validate(child, depth + 1));
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.values(item).every(child => validate(child, depth + 1));
  };
  if (!validate(request.reference, 0) || JSON.stringify(request.reference).length > 65_536) throw new TypeError("Invalid execution reference");
  return { id: request.id, reference: request.reference as ExecutionReference };
}
