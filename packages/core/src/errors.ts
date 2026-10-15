/** Transport-independent business failure. HTTP/Queue entries decide how to expose it. */
export class ServiceError extends Error {
  readonly status: number;
  constructor(status: number, options: Readonly<{ message: string; cause?: unknown }>) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ServiceError";
    this.status = status;
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigurationError"; }
}
