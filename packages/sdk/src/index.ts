import type { DocumentCommand, DocumentCommands, DocumentResults } from "@tabdo/shared";
import type { CalendarCommand, CalendarCommands, CalendarResults } from "@tabdo/shared";
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
const rowFields = "id tableId version cells files { id columnId name mimeType size url } createdAt updatedAt";

/** A dependency-free runtime: shared imports are types and disappear from JS. */
export function createClient(options: ClientOptions) {
  const base = new URL(options.url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new TypeError("Use an HTTP(S) Tabdo API URL without credentials");
  if (!/^tab_(?:pub_)?[A-Za-z0-9_-]{43}$/.test(options.key)) throw new TypeError("Use a valid API key");
  const endpoint = new URL("/api/graphql", base);
  const transport = options.fetch ?? globalThis.fetch;
  async function graphql<T>(query: string, variables: Record<string, unknown> = {}, request: RequestOptions & { operationName?: string } = {}): Promise<T> {
    let response: Response;
    try {
      response = await transport(endpoint.href, { method: "POST", credentials: "omit", redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.key}` },
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
  // Aborting transport does not cancel a server transaction. Retry the same input/key to read its receipt.
  async function calendarCommand<K extends CalendarCommand>(command: K, input: CalendarCommands[K], request?: RequestOptions): Promise<CalendarResults[K]> {
    const read = ["listCalendars", "getCalendar", "listCalendarPeople", "getCalendarPerson", "getWorkingHours", "listAvailabilityExceptions", "queryBookings", "getBooking", "queryAvailability", "checkBookingConflicts"].includes(command);
    const result = await graphql<Record<K, CalendarResults[K]>>(`${read ? "query" : "mutation"} CalendarCommand($input: JSON!) { ${command}(input: $input) }`, { input }, request);
    return result[command];
  }
  async function documentCommand<K extends DocumentCommand>(command: K, input: DocumentCommands[K], request?: RequestOptions): Promise<DocumentResults[K]> {
    const read = ["getDocument", "listDocumentRevisions", "getDocumentRevision", "renderDocument", "getDocumentImage"].includes(command);
    const result = await graphql<Record<K, DocumentResults[K]>>(`${read ? "query" : "mutation"} DocumentCommand($input: JSON!) { ${command}(input: $input) }`, { input }, request);
    return result[command];
  }
  const documentApi = {
    getDocument: (input: DocumentCommands["getDocument"], request?: RequestOptions) => documentCommand("getDocument", input, request),
    createDocument: (input: DocumentCommands["createDocument"], request?: RequestOptions) => documentCommand("createDocument", input, request),
    replaceDocument: (input: DocumentCommands["replaceDocument"], request?: RequestOptions) => documentCommand("replaceDocument", input, request),
    listDocumentRevisions: (input: DocumentCommands["listDocumentRevisions"], request?: RequestOptions) => documentCommand("listDocumentRevisions", input, request),
    getDocumentRevision: (input: DocumentCommands["getDocumentRevision"], request?: RequestOptions) => documentCommand("getDocumentRevision", input, request),
    restoreDocumentRevision: (input: DocumentCommands["restoreDocumentRevision"], request?: RequestOptions) => documentCommand("restoreDocumentRevision", input, request),
    renderDocument: (input: DocumentCommands["renderDocument"], request?: RequestOptions) => documentCommand("renderDocument", input, request),
    uploadDocumentImage: (input: DocumentCommands["uploadDocumentImage"], request?: RequestOptions) => documentCommand("uploadDocumentImage", input, request),
    getDocumentImage: (input: DocumentCommands["getDocumentImage"], request?: RequestOptions) => documentCommand("getDocumentImage", input, request),
  };
  const calendarApi = {
    listCalendars: (input: CalendarCommands["listCalendars"], request?: RequestOptions) => calendarCommand("listCalendars", input, request),
    getCalendar: (input: CalendarCommands["getCalendar"], request?: RequestOptions) => calendarCommand("getCalendar", input, request),
    createCalendar: (input: CalendarCommands["createCalendar"], request?: RequestOptions) => calendarCommand("createCalendar", input, request),
    updateCalendar: (input: CalendarCommands["updateCalendar"], request?: RequestOptions) => calendarCommand("updateCalendar", input, request),
    archiveCalendar: (input: CalendarCommands["archiveCalendar"], request?: RequestOptions) => calendarCommand("archiveCalendar", input, request),
    listCalendarPeople: (input: CalendarCommands["listCalendarPeople"], request?: RequestOptions) => calendarCommand("listCalendarPeople", input, request),
    getCalendarPerson: (input: CalendarCommands["getCalendarPerson"], request?: RequestOptions) => calendarCommand("getCalendarPerson", input, request),
    createCalendarPerson: (input: CalendarCommands["createCalendarPerson"], request?: RequestOptions) => calendarCommand("createCalendarPerson", input, request),
    updateCalendarPerson: (input: CalendarCommands["updateCalendarPerson"], request?: RequestOptions) => calendarCommand("updateCalendarPerson", input, request),
    archiveCalendarPerson: (input: CalendarCommands["archiveCalendarPerson"], request?: RequestOptions) => calendarCommand("archiveCalendarPerson", input, request),
    getWorkingHours: (input: CalendarCommands["getWorkingHours"], request?: RequestOptions) => calendarCommand("getWorkingHours", input, request),
    setWorkingHours: (input: CalendarCommands["setWorkingHours"], request?: RequestOptions) => calendarCommand("setWorkingHours", input, request),
    listAvailabilityExceptions: (input: CalendarCommands["listAvailabilityExceptions"], request?: RequestOptions) => calendarCommand("listAvailabilityExceptions", input, request),
    setAvailabilityException: (input: CalendarCommands["setAvailabilityException"], request?: RequestOptions) => calendarCommand("setAvailabilityException", input, request),
    removeAvailabilityException: (input: CalendarCommands["removeAvailabilityException"], request?: RequestOptions) => calendarCommand("removeAvailabilityException", input, request),
    queryBookings: (input: CalendarCommands["queryBookings"], request?: RequestOptions) => calendarCommand("queryBookings", input, request),
    getBooking: (input: CalendarCommands["getBooking"], request?: RequestOptions) => calendarCommand("getBooking", input, request),
    createBooking: (input: CalendarCommands["createBooking"], request?: RequestOptions) => calendarCommand("createBooking", input, request),
    rescheduleBooking: (input: CalendarCommands["rescheduleBooking"], request?: RequestOptions) => calendarCommand("rescheduleBooking", input, request),
    cancelBooking: (input: CalendarCommands["cancelBooking"], request?: RequestOptions) => calendarCommand("cancelBooking", input, request),
    queryAvailability: (input: CalendarCommands["queryAvailability"], request?: RequestOptions) => calendarCommand("queryAvailability", input, request),
    checkBookingConflicts: (input: CalendarCommands["checkBookingConflicts"], request?: RequestOptions) => calendarCommand("checkBookingConflicts", input, request),
    batchBookings: (input: CalendarCommands["batchBookings"], request?: RequestOptions) => calendarCommand("batchBookings", input, request),
  };
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
      async update(rowId: string, cells: Record<string, CellValue>, request?: RequestOptions & { expectedVersion?: number }): Promise<{ id: string; updatedAt: string; version: number }> {
        const result = await graphql<{ updateRow: { id: string; updatedAt: string; version: number } }>("mutation UpdateRow($tableId: ID!, $rowId: ID!, $cells: JSON!, $version: Int) { updateRow(tableId: $tableId, rowId: $rowId, cells: $cells, expectedVersion: $version) { id updatedAt version } }", { tableId, rowId, cells, version: request?.expectedVersion }, request);
        return result.updateRow;
      },
      async delete(rowId: string, request?: RequestOptions): Promise<{ id: string }> {
        return (await graphql<{ deleteRow: { id: string } }>("mutation DeleteRow($tableId: ID!, $rowId: ID!) { deleteRow(tableId: $tableId, rowId: $rowId) { id } }", { tableId, rowId }, request)).deleteRow;
      },
      async create(cells: Record<string, CellValue>, request?: RequestOptions): Promise<SiteCreateReceipt> {
        const result = await graphql<{ createRow: SiteCreateReceipt }>("mutation CreateRow($tableId: ID!, $cells: JSON!) { createRow(tableId: $tableId, cells: $cells) { id createdAt } }", { tableId, cells }, request);
        return result.createRow;
      },
    };
  }
  return { graphql, table, calendar: calendarApi, documents: documentApi, async tables(request?: RequestOptions): Promise<SiteTable[]> {
    return (await graphql<{ tables: SiteTable[] }>(`query Tables { tables { id name description columns { ${columnFields} } } }`, {}, request)).tables;
  } };
}
export type TabdoClient = ReturnType<typeof createClient>;
