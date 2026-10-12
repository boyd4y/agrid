import type { FilterCondition, FilterLogic } from "./filters.js";
import type { RowData } from "./types.js";

/** Default / max page sizes for windowed row APIs (Feishu-class) */
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;
export const AGENT_DEFAULT_PAGE_SIZE = 50;
export const AGENT_MAX_PAGE_SIZE = 200;

export type RowCursor = {
  sortOrder: number;
  id: string;
  /** present when sorting by a cell column */
  sortValue?: string | null;
};

export type QueryRowsInput = {
  tableId: string;
  filters?: FilterCondition[];
  filterLogic?: FilterLogic;
  sort?: { columnId: string; direction: "asc" | "desc" } | null;
  cursor?: string | null;
  limit?: number;
  includeTotal?: boolean;
  statusColumnId?: string;
  statusValue?: string | null;
};

export type QueryRowsResult = {
  rows: RowData[];
  nextCursor: string | null;
  hasMore: boolean;
  totalMatched?: number;
  limit: number;
};

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "";
    out += i + 2 < bytes.length ? B64[c & 63] : "";
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(raw: string): Uint8Array {
  const s = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const len = (pad.replace(/=/g, "").length * 3) >> 2;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < pad.length; i += 4) {
    const a = lookup[pad.charCodeAt(i)]!;
    const b = lookup[pad.charCodeAt(i + 1)]!;
    const c = pad[i + 2] === "=" ? 0 : lookup[pad.charCodeAt(i + 2)]!;
    const d = pad[i + 3] === "=" ? 0 : lookup[pad.charCodeAt(i + 3)]!;
    out[o++] = (a << 2) | (b >> 4);
    if (pad[i + 2] !== "=") out[o++] = ((b & 15) << 4) | (c >> 2);
    if (pad[i + 3] !== "=") out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export function encodeCursor(c: RowCursor): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(c)));
}

export function decodeCursor(raw: string | null | undefined): RowCursor | null {
  if (!raw) return null;
  try {
    const json = new TextDecoder().decode(decodeBase64Url(raw));
    const parsed = JSON.parse(json) as RowCursor;
    if (typeof parsed.sortOrder !== "number" || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clampLimit(
  limit: number | undefined,
  fallback: number,
  max: number
): number {
  const n = Math.floor(limit ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
