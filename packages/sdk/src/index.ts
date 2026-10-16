import type { CellValue, SiteColumn, SiteTable, SiteRow, SiteRowsOptions, SiteRowsPage, SiteCreateReceipt } from "@tabdo/shared";
export type { CellValue, SiteColumn, SiteTable, SiteRow, SiteRowsOptions, SiteRowsPage, SiteFile, SiteCreateReceipt } from "@tabdo/shared";

export class TabdoApiError extends Error {
  readonly name = "TabdoApiError";
  constructor(message: string, public readonly code: string, public readonly status: number,
    public readonly errors: ReadonlyArray<{ message: string; extensions?: Record<string, unknown> }> = []) { super(message); }
}
export type RequestOptions = { signal?: AbortSignal };
export type ClientOptions = { url: string; key: string; fetch?: typeof globalThis.fetch };
const columnFields = "id name type options { id label color } readable writable";
const rowFields = "id tableId cells files { id columnId name mimeType size url } createdAt updatedAt";

/** A dependency-free runtime: shared imports are types and disappear from JS. */
export function createClient(options: ClientOptions) {
  const base = new URL(options.url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new TypeError("Use an HTTP(S) Tabdo API URL without credentials");
  if (!/^tab_pub_[A-Za-z0-9_-]{43}$/.test(options.key)) throw new TypeError("Use a publishable site API key, not a personal API key");
  const endpoint = new URL("/api/graphql", base);
  const transport = options.fetch ?? globalThis.fetch;
  async function graphql<T>(query: string, variables: Record<string, unknown> = {}, request: RequestOptions & { operationName?: string } = {}): Promise<T> {
    let response: Response;
    try {
      response = await transport(endpoint.href, { method: "POST", credentials: "omit", redirect: "error",
        headers: { "Content-Type": "application/json", "X-Tabdo-Key": options.key },
        body: JSON.stringify({ query, variables, ...(request.operationName ? { operationName: request.operationName } : {}) }), signal: request.signal });
    } catch (error) {
      if (request.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
      throw new TabdoApiError("Could not reach the Tabdo API", "NETWORK_ERROR", 0);
    }
    let result: { data?: T; errors?: { message: string; extensions?: Record<string, unknown> }[] };
    try { result = await response.json(); }
    catch (error) {
      if (request.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
      throw new TabdoApiError("Invalid API response", "INVALID_RESPONSE", response.status);
    }
    if (!result || typeof result !== "object" || Array.isArray(result) || result.errors !== undefined && !Array.isArray(result.errors))
      throw new TabdoApiError("Invalid API response", "INVALID_RESPONSE", response.status);
    if (!response.ok || result.errors?.length) {
      const error = result.errors?.[0];
      throw new TabdoApiError(error?.message ?? `Request failed (${response.status})`, String(error?.extensions?.code ?? "REQUEST_FAILED"), response.status, result.errors);
    }
    if (result.data === undefined || result.data === null) throw new TabdoApiError("Missing API response data", "INVALID_RESPONSE", response.status);
    return result.data;
  }
  function table(tableId: string) {
    return {
      async columns(request?: RequestOptions): Promise<SiteColumn[]> {
        const result = await graphql<{ table: SiteTable }>(`query TableColumns($id: ID!) { table(id: $id) { columns { ${columnFields} } } }`, { id: tableId }, request);
        return result.table.columns;
      },
      async list(input: SiteRowsOptions = {}, request?: RequestOptions): Promise<SiteRowsPage> {
        const result = await graphql<{ table: { rows: SiteRowsPage } }>(`query TableRows($id: ID!, $options: RowsInput) { table(id: $id) { rows(options: $options) { rows { ${rowFields} } nextCursor hasMore totalMatched limit } } }`, { id: tableId, options: input }, request);
        return result.table.rows;
      },
      async get(rowId: string, request?: RequestOptions): Promise<SiteRow | null> {
        const result = await graphql<{ table: { row: SiteRow | null } }>(`query TableRow($id: ID!, $rowId: ID!) { table(id: $id) { row(id: $rowId) { ${rowFields} } } }`, { id: tableId, rowId }, request);
        return result.table.row;
      },
      async create(cells: Record<string, CellValue>, request?: RequestOptions): Promise<SiteCreateReceipt> {
        const result = await graphql<{ createRow: SiteCreateReceipt }>("mutation CreateRow($tableId: ID!, $cells: JSON!) { createRow(tableId: $tableId, cells: $cells) { id createdAt } }", { tableId, cells }, request);
        return result.createRow;
      },
    };
  }
  return { graphql, table, async tables(request?: RequestOptions): Promise<SiteTable[]> {
    return (await graphql<{ tables: SiteTable[] }>(`query Tables { tables { id name description columns { ${columnFields} } } }`, {}, request)).tables;
  } };
}
export type TabdoClient = ReturnType<typeof createClient>;
