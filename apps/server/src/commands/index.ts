export { createCalendarView, updateCalendarView, queryCalendarView } from "./calendar-views.js";
import * as calendarViewCmds from "./calendar-views.js";
export * from "./calendar.js";
import * as calendarCommands from "./calendar.js";
import * as implementation from "../business/commands/index.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const createView = (...args: Arguments<typeof implementation.createView>) => businessCall(() => implementation.createView(commandDependencies(), ...args));
export const updateView = (...args: Arguments<typeof implementation.updateView>) => businessCall(() => implementation.updateView(commandDependencies(), ...args));
export const uploadRowAttachment = (...args: Arguments<typeof implementation.uploadRowAttachment>) => businessCall(() => implementation.uploadRowAttachment(commandDependencies(), ...args));
export const getRowAttachment = (...args: Arguments<typeof implementation.getRowAttachment>) => businessCall(() => implementation.getRowAttachment(commandDependencies(), ...args));
export const listTables = (...args: Arguments<typeof implementation.listTables>) =>
  businessCall(() => implementation.listTables(commandDependencies(), ...args));
export const getTable = (...args: Arguments<typeof implementation.getTable>) =>
  businessCall(() => implementation.getTable(commandDependencies(), ...args));
export const createTable = (...args: Arguments<typeof implementation.createTable>) =>
  businessCall(() => implementation.createTable(commandDependencies(), ...args));
export const updateCell = (...args: Arguments<typeof implementation.updateCell>) =>
  businessCall(() => implementation.updateCell(commandDependencies(), ...args));
export const updateCells = (...args: Arguments<typeof implementation.updateCells>) =>
  businessCall(() => implementation.updateCells(commandDependencies(), ...args));
export const updateCellsInTransaction = (...args: Arguments<typeof implementation.updateCellsInTransaction>) =>
  businessCall(() => implementation.updateCellsInTransaction(commandDependencies(), ...args));
export const setRelation = (...args: Arguments<typeof implementation.setRelation>) =>
  businessCall(() => implementation.setRelation(commandDependencies(), ...args));
export const addRelation = (...args: Arguments<typeof implementation.addRelation>) =>
  businessCall(() => implementation.addRelation(commandDependencies(), ...args));
export const removeRelation = (...args: Arguments<typeof implementation.removeRelation>) =>
  businessCall(() => implementation.removeRelation(commandDependencies(), ...args));
export const addRow = (...args: Arguments<typeof implementation.addRow>) =>
  businessCall(() => implementation.addRow(commandDependencies(), ...args));
export const batchAddRows = (...args: Arguments<typeof implementation.batchAddRows>) =>
  businessCall(() => implementation.batchAddRows(commandDependencies(), ...args));
export const prepareBatchRowWrites = (...args: Arguments<typeof implementation.prepareBatchRowWrites>) =>
  businessCall(() => implementation.prepareBatchRowWrites(commandDependencies(), ...args));
export const batchUpdateRows = (...args: Arguments<typeof implementation.batchUpdateRows>) =>
  businessCall(() => implementation.batchUpdateRows(commandDependencies(), ...args));
export const deleteRow = (...args: Arguments<typeof implementation.deleteRow>) =>
  businessCall(() => implementation.deleteRow(commandDependencies(), ...args));
export const batchDeleteRows = (...args: Arguments<typeof implementation.batchDeleteRows>) =>
  businessCall(() => implementation.batchDeleteRows(commandDependencies(), ...args));
export const deleteTable = (...args: Arguments<typeof implementation.deleteTable>) =>
  businessCall(() => implementation.deleteTable(commandDependencies(), ...args));
export const reorderColumns = (...args: Arguments<typeof implementation.reorderColumns>) =>
  businessCall(() => implementation.reorderColumns(commandDependencies(), ...args));
export const queryRows = (...args: Arguments<typeof implementation.queryRows>) =>
  businessCall(() => implementation.queryRows(commandDependencies(), ...args));
export const setStatus = (...args: Arguments<typeof implementation.setStatus>) =>
  businessCall(() => implementation.setStatus(commandDependencies(), ...args));
export type { OrgScoped } from "../business/commands/index.js";
export const moveCard = (...args: Arguments<typeof implementation.moveCard>) =>
  businessCall(() => implementation.moveCard(commandDependencies(), ...args));
export const listAutomations = (...args: Arguments<typeof implementation.listAutomations>) =>
  businessCall(() => implementation.listAutomations(commandDependencies(), ...args));
export const createAutomation = (...args: Arguments<typeof implementation.createAutomation>) =>
  businessCall(() => implementation.createAutomation(commandDependencies(), ...args));
export const updateAutomation = (...args: Arguments<typeof implementation.updateAutomation>) =>
  businessCall(() => implementation.updateAutomation(commandDependencies(), ...args));
export const deleteAutomation = (...args: Arguments<typeof implementation.deleteAutomation>) =>
  businessCall(() => implementation.deleteAutomation(commandDependencies(), ...args));
export const listAutomationRuns = (...args: Arguments<typeof implementation.listAutomationRuns>) =>
  businessCall(() => implementation.listAutomationRuns(commandDependencies(), ...args));
export { getWorkspace, listWorkspaces, createWorkspace, listMembers } from "./workspace.js";
export { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
export { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
export { countTableRows, queryRowsWindowed, recomputeAllFormulasForTable };
export {
  listViews,
  getView,
  deleteView,
  renameView,
  setDefaultView,
  updateBoardView,
  createFormView,
  createGridView,
  createBoardView,
  updateFormView,
  setFormFields,
  addFormField,
  removeFormField,
  reorderFormFields,
  setFormSections,
  setFormTheme,
  setFormLayout,
  setFormFieldSettings,
  setFormChrome,
  ensureDemoFormView,
} from "./views.js";
export { getRow, queryRelationRecords } from "./relations.js";
import { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
import { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
import { queryRowsWindowed, countTableRows } from "./queryRows.js";
import { recomputeAllFormulasForTable } from "./formulas.js";
import * as viewCmds from "./views.js";
import { getRow, queryRelationRecords } from "./relations.js";
export const commands = {
  createView, updateView, uploadRowAttachment, getRowAttachment,
  ...calendarCommands,
  batchSetRelations,
  batchAddRelations,
  batchRemoveRelations,
  batchAddColumns,
  batchUpdateColumns,
  batchDeleteColumns,
  getRow,
  setRelation,
  addRelation,
  removeRelation,
  queryRelationRecords,
  listTables,
  getTable,
  createTable,
  updateCell,
  updateCells,
  addRow,
  batchAddRows,
  batchUpdateRows,
  batchDeleteRows,
  deleteRow,
  addColumn,
  deleteColumn,
  updateColumn,
  reorderColumns,
  queryRows,
  setStatus,
  moveCard,
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
  listViews: viewCmds.listViews,
  getView: viewCmds.getView,
  deleteView: viewCmds.deleteView,
  renameView: viewCmds.renameView,
  setDefaultView: viewCmds.setDefaultView,
  updateBoardView: viewCmds.updateBoardView,
  createCalendarView: calendarViewCmds.createCalendarView,
  updateCalendarView: calendarViewCmds.updateCalendarView,
  queryCalendarView: calendarViewCmds.queryCalendarView,
  createFormView: viewCmds.createFormView,
  createGridView: viewCmds.createGridView,
  createBoardView: viewCmds.createBoardView,
  updateFormView: viewCmds.updateFormView,
  setFormFields: viewCmds.setFormFields,
  addFormField: viewCmds.addFormField,
  removeFormField: viewCmds.removeFormField,
  reorderFormFields: viewCmds.reorderFormFields,
  setFormSections: viewCmds.setFormSections,
  setFormTheme: viewCmds.setFormTheme,
  setFormLayout: viewCmds.setFormLayout,
  setFormFieldSettings: viewCmds.setFormFieldSettings,
  setFormChrome: viewCmds.setFormChrome,
};
