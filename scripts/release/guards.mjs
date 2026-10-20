export class ReleaseError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function requireRelease(condition, code) {
  if (!condition) throw new ReleaseError(code);
}

export function databaseIdentity(value) {
  try {
    const url = new URL(value);
    requireRelease(["postgres:", "postgresql:"].includes(url.protocol), "database_target_mismatch");
    return `${url.hostname.replace(/-pooler\./, ".")}:${url.port || "5432"}${url.pathname}:${url.username}`;
  } catch { throw new ReleaseError("database_target_mismatch"); }
}
