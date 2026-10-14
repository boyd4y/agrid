import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tabdo/ui/components/collapsible";
import { Skeleton } from "@tabdo/ui/components/skeleton";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { COLUMN_TYPES, AUTOMATION_DATA_COMMANDS, type AutomationDataCommand, type AutomationSource } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@tabdo/ui/components/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import { ColumnTypeIcon } from "@/components/table/ColumnTypeIcon";
import { api, type MemberOption } from "@/lib/api";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { CellValue, ColumnDef, FullTable, RowData } from "@/types/table";
import { automationEventFields, BoundValueEditor, type EventField } from "./AutomationBindings";
import { AutomationJsonInput } from "./AutomationJsonInput";

export function defaultCommandInput(command: AutomationDataCommand, source: AutomationSource): Record<string, unknown> {
  const rowId = source.kind === "table" ? { $event: "row.id" } : "";
  if (command === "addRow") return { tableId: source.kind === "table" ? source.tableId : "", cells: {} };
  if (command === "updateCells") return { rowId, cells: {} };
  if (["updateCell", "setStatus", "moveCard"].includes(command)) return { rowId, columnId: "", ...(command === "updateCell" ? { value: null } : { statusOptionId: "" }) };
  if (["setRelation", "addRelation", "removeRelation"].includes(command)) return { rowId, columnId: "", recordIds: [] };
  if (command === "deleteRow") return { rowId };
  if (command === "addColumn") return { tableId: source.kind === "table" ? source.tableId : "", name: "", type: "text" };
  if (command === "updateColumn" || command === "deleteColumn") return { columnId: "" };
  if (command === "reorderColumns") return { tableId: source.kind === "table" ? source.tableId : "", columnIds: [] };
  if (command === "batchAddRows") return { tableId: source.kind === "table" ? source.tableId : "", rows: [{ cells: {} }] };
  if (command === "batchUpdateRows") return { updates: [] };
  if (command === "batchDeleteRows") return { rowIds: [] };
  if (command === "batchAddColumns") return { tableId: source.kind === "table" ? source.tableId : "", columns: [] };
  if (command === "batchUpdateColumns") return { columns: [] };
  if (command === "batchDeleteColumns") return { columnIds: [] };
  return { relations: [] };
}
function recordTitle(row: RowData, columns: ColumnDef[]) { const title = columns.find(column => column.type === "text"); return String(title && row.cells[title.id] || row.id.slice(0, 8)); }
function RecordChoice({ table, value, onChange }: { table: FullTable | null; value: unknown; onChange: (value: unknown) => void }) {
  const { t } = useTranslation("automation");
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [rows, setRows] = useState<RowData[]>([]), [selected, setSelected] = useState<RowData | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => { let cancelled = false; setRows([]); setError(null); if (!open || !table) return; setLoading(true); const title = table.columns.find(column => column.type === "text"); const timer = setTimeout(() => { void api.queryRowsPage(table.id, { limit: 30, filters: search && title ? [{ id: "action-search", columnId: title.id, op: "contains", value: search }] : [] }).then(page => { if (!cancelled) setRows(page.rows); }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); }); }, 150); return () => { cancelled = true; clearTimeout(timer); }; }, [table, open, search]);
  useEffect(() => { let cancelled = false; setSelected(null); if (typeof value === "string" && value && table) void api.getRow(value).then(row => { if (!cancelled && row.tableId === table.id) setSelected(row); }).catch(() => {}); return () => { cancelled = true; }; }, [value, table]);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" disabled={!table} className="w-full justify-between"><span className="truncate">{selected && table ? recordTitle(selected, table.columns) : t("generic.pickRecord")}</span><ChevronsUpDown data-icon="inline-end" /></Button></PopoverTrigger><PopoverContent className="w-80 p-0"><Command shouldFilter={false}><CommandInput value={search} onValueChange={setSearch} placeholder={t("generic.searchRecords")} /><CommandList><CommandEmpty>{error ?? (loading ? t("loading") : t("generic.noRecords"))}</CommandEmpty><CommandGroup>{rows.map(row => <CommandItem key={row.id} value={row.id} onSelect={() => { onChange(row.id); setSelected(row); setOpen(false); }}><span className="min-w-0 flex-1 truncate">{recordTitle(row, table!.columns)}</span>{row.id === value && <Check />}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>;
}

export function AutomationDataActionFields({ command, input, onCommandChange, onChange, source, step, members, sourceColumns = [], onInvalidChange, onPendingChange, actionTypeControl, removeControl }: { command: AutomationDataCommand; input: Record<string, unknown>; onCommandChange: (command: AutomationDataCommand) => void; onChange: (input: Record<string, unknown>) => void; source: AutomationSource; step: number; members: MemberOption[]; sourceColumns?: ColumnDef[]; onInvalidChange: (invalid: boolean) => void; onPendingChange: (pending: boolean) => void; actionTypeControl?: ReactNode; removeControl?: ReactNode }) {
  const { t } = useTranslation("automation"), { tables } = useOutletContext<AppOutletContext>();
  const initialTableId = typeof input.tableId === "string" ? input.tableId : source.kind === "table" ? source.tableId : "";
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange;
  useEffect(() => () => pendingCallback.current(false), []);
  const [pendingFields, setPendingFields] = useState<Record<string, boolean>>({});
  useEffect(() => { pendingCallback.current(Object.values(pendingFields).some(Boolean)); }, [pendingFields]);
  const [targetTableId, setTargetTableId] = useState(initialTableId), [table, setTable] = useState<FullTable | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; setTable(null); setError(null); if (targetTableId) void api.getTable(targetTableId).then(table => { if (!cancelled) setTable(table); }).catch(error => { if (!cancelled) setError(error.message); }); return () => { cancelled = true; }; }, [targetTableId]);
  useEffect(() => { if (typeof input.tableId === "string" && input.tableId) setTargetTableId(input.tableId); }, [input.tableId]);
  useEffect(() => { let cancelled = false; if (typeof input.rowId === "string" && input.rowId && !input.columnId) void api.getRow(input.rowId).then(row => { if (!cancelled) setTargetTableId(row.tableId); }).catch(() => {}); return () => { cancelled = true; }; }, [input.rowId, input.columnId]);
  useEffect(() => { let cancelled = false; if (typeof input.columnId === "string" && input.columnId) void api.getColumn(input.columnId).then(column => { if (!cancelled) setTargetTableId(column.tableId); }).catch(error => { if (!cancelled) setError(error.message); }); return () => { cancelled = true; }; }, [input.columnId]);
  const eventFields: EventField[] = [...automationEventFields(source.kind), ...(source.kind === "table" ? sourceColumns.map(column => ({ path: `row.cells.${column.id}`, label: column.name, type: "text" as const })) : [])];
  const set = (key: string, value: unknown) => onChange({ ...input, [key]: value });
  const batch = command.startsWith("batch"), schemaAdvanced = batch || ["addColumn", "updateColumn", "reorderColumns"].includes(command);
  const hasRow = ["updateCell", "updateCells", "deleteRow", "setStatus", "moveCard", "setRelation", "addRelation", "removeRelation"].includes(command);
  const hasColumn = ["updateCell", "setStatus", "moveCard", "setRelation", "addRelation", "removeRelation", "deleteColumn", "updateColumn"].includes(command);
  const columns = (table?.columns ?? []).filter(column => !["formula", "rollup"].includes(column.type));
  const choiceColumns = ["setStatus", "moveCard"].includes(command) ? columns.filter(column => column.type === "select") : command.endsWith("Relation") ? columns.filter(column => column.type === "relation") : ["deleteColumn", "updateColumn"].includes(command) ? table?.columns ?? [] : columns;
  const column = columns.find(column => column.id === input.columnId);
  const cells = input.cells && typeof input.cells === "object" && !Array.isArray(input.cells) ? input.cells as Record<string, unknown> : {};
  const valueControl = (column: ColumnDef, value: unknown, onChange: (value: unknown) => void) => <BoundValueEditor value={value} onChange={onChange} source={source} step={step} eventFields={eventFields} emptyValue={column.type === "checkbox" ? false : ["person", "multi_select", "relation", "file"].includes(column.type) ? [] : null} literal={(value, onChange) => <FormFieldControl column={column} value={value as CellValue} onChange={onChange} members={members} onPendingChange={pending => setPendingFields(previous => previous[column.id] === pending ? previous : { ...previous, [column.id]: pending })} />} />;
  return <FieldGroup className="gap-4">
    <FieldGroup className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]" data-testid="automation-action-header">{actionTypeControl}
    <Field className="col-span-2 min-w-0 sm:col-span-1"><FieldLabel>{t("generic.command")}</FieldLabel><Select value={command} onValueChange={value => onCommandChange(value as AutomationDataCommand)}><SelectTrigger aria-label={t("generic.command")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{AUTOMATION_DATA_COMMANDS.map(command => <SelectItem key={command} value={command}>{t(`generic.commands.${command}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>{removeControl}</FieldGroup>
    {!batch && <FieldGroup className="grid min-w-0 gap-3 sm:grid-cols-2" data-testid="automation-action-targets"><Field className="min-w-0"><FieldLabel>{t("generic.targetTable")}</FieldLabel><Select value={targetTableId} onValueChange={id => { setTargetTableId(id); onChange({ ...defaultCommandInput(command, { kind: "table", tableId: id }), ...(hasRow ? { rowId: "" } : {}) }); }}><SelectTrigger aria-label={t("generic.targetTable")}><SelectValue placeholder={t("pickSourceTable")} /></SelectTrigger><SelectContent><SelectGroup>{tables.map(table => <SelectItem key={table.id} value={table.id}>{table.name}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldDescription role="alert">{error}</FieldDescription>}</Field>
    {hasRow && <Field className="min-w-0"><FieldLabel>{t("generic.record")}</FieldLabel><BoundValueEditor value={input.rowId} onChange={value => set("rowId", value)} source={source} step={step} eventFields={eventFields} emptyValue="" literal={(value, onChange) => <RecordChoice table={table} value={value} onChange={onChange} />} /></Field>}</FieldGroup>}
    {hasColumn && <FieldGroup className="grid min-w-0 gap-3 sm:grid-cols-2">{hasColumn && <Field className="min-w-0"><FieldLabel>{t("field")}</FieldLabel><Select value={typeof input.columnId === "string" ? input.columnId : ""} onValueChange={id => onChange({ ...input, columnId: id, ...(command === "updateCell" ? { value: null } : command.endsWith("Relation") ? { recordIds: [] } : ["setStatus", "moveCard"].includes(command) ? { statusOptionId: "" } : {}) })}><SelectTrigger aria-label={t("field")}><SelectValue placeholder={t("fieldPlaceholder")} /></SelectTrigger><SelectContent><SelectGroup>{choiceColumns.map(column => <SelectItem key={column.id} value={column.id}><ColumnTypeIcon type={column.type} />{column.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
    {column && command === "updateCell" && <Field className="min-w-0"><FieldLabel>{t("generic.value")}</FieldLabel>{valueControl(column, input.value, value => set("value", value))}</Field>}
    {column && command.endsWith("Relation") && <Field className="min-w-0"><FieldLabel>{t("generic.relatedRecords")}</FieldLabel>{valueControl(column, input.recordIds, value => set("recordIds", value))}</Field>}
    {column && ["setStatus", "moveCard"].includes(command) && <Field className="min-w-0"><FieldLabel>{t("status")}</FieldLabel>{valueControl(column, input.statusOptionId, value => set("statusOptionId", value))}</Field>}
    </FieldGroup>}
    {["addRow", "updateCells"].includes(command) && <FieldGroup>{Object.entries(cells).map(([id, value]) => { const column = columns.find(column => column.id === id); return <Field key={id} className="min-w-0 gap-2 sm:grid sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)] sm:items-start"><div className="flex items-center justify-between gap-2"><FieldLabel>{column?.name ?? id}</FieldLabel><Button type="button" variant="ghost" size="icon" aria-label={t("generic.removeField")} onClick={() => { const next = { ...cells }; delete next[id]; set("cells", next); }}><Trash2 /></Button></div>{column ? valueControl(column, value, value => set("cells", { ...cells, [id]: value })) : !table ? <Skeleton className="h-9 w-full" /> : <FieldDescription>{t("generic.missingField")}</FieldDescription>}</Field>; })}<Field><Select value="" onValueChange={id => set("cells", { ...cells, [id]: null })}><SelectTrigger aria-label={t("generic.addField")}><Plus /><SelectValue placeholder={t("generic.addField")} /></SelectTrigger><SelectContent><SelectGroup>{columns.filter(column => !(column.id in cells)).map(column => <SelectItem key={column.id} value={column.id}>{column.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup>}
    {["addColumn", "updateColumn"].includes(command) && <FieldGroup className="grid min-w-0 gap-3 sm:grid-cols-3"><Field className="min-w-0"><FieldLabel>{t("generic.fieldName")}</FieldLabel><Input aria-label={t("generic.fieldName")} value={typeof input.name === "string" ? input.name : ""} onChange={event => set("name", event.target.value)} /></Field><Field><FieldLabel>{t("generic.fieldType")}</FieldLabel><Select value={typeof input.type === "string" ? input.type : command === "updateColumn" ? table?.columns.find(column => column.id === input.columnId)?.type : "text"} onValueChange={type => set("type", type)}><SelectTrigger aria-label={t("generic.fieldType")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{COLUMN_TYPES.map(type => <SelectItem key={type} value={type}><ColumnTypeIcon type={type} />{t(`table:columnTypes.${type}`, { defaultValue: type })}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>{t("generic.fieldWidth")}</FieldLabel><Input type="number" min={1} aria-label={t("generic.fieldWidth")} value={typeof input.width === "number" ? input.width : ""} onChange={event => { const next = { ...input }; if (event.target.value) next.width = Number(event.target.value); else delete next.width; onChange(next); }} /></Field></FieldGroup>}
    {schemaAdvanced && <AutomationJsonInput key={command} label={t("generic.actionInput")} value={input} onChange={value => onChange(value as Record<string, unknown>)} onInvalidChange={onInvalidChange} />}
    {!schemaAdvanced && <Collapsible><CollapsibleTrigger asChild><Button type="button" size="sm" variant="ghost"><ChevronRight data-icon="inline-start" />{t("generic.advanced")}</Button></CollapsibleTrigger><CollapsibleContent className="mt-3"><AutomationJsonInput label={t("generic.actionInput")} value={input} onChange={value => onChange(value as Record<string, unknown>)} onInvalidChange={onInvalidChange} /></CollapsibleContent></Collapsible>}
  </FieldGroup>;
}
