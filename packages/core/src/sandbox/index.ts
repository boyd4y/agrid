export type SandboxHandle<Session = unknown, Workspace = never> = Readonly<{
  session: Session;
  workspace?: Workspace;
}>;

/** Lifecycle only; implementations specialize the native SDK session without redefining its APIs. */
export interface SandboxAdapter<CreateOptions = unknown, ResumeOptions = unknown, Session = unknown, Workspace = never> {
  readonly networkAccessible: boolean;
  create(options?: CreateOptions): Promise<SandboxHandle<Session, Workspace>>;
  resume(options: ResumeOptions): Promise<SandboxHandle<Session, Workspace>>;
}

export class SandboxConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "SandboxConfigurationError"; }
}
