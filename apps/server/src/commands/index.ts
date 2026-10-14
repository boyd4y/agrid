import * as implementation from "@tabdo/backend/commands";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const listTables = (...args: Arguments<typeof implementation.listTables>) =>
  backendCall(() => implementation.listTables(commandDependencies(), ...args));
export const getTable = (...args: Arguments<typeof implementation.getTable>) =>
  backendCall(() => implementation.getTable(commandDependencies(), ...args));
export const createTable = (...args: Arguments<typeof implementation.createTable>) =>
  backendCall(() => implementation.createTable(commandDependencies(), ...args));
export const updateCell = (...args: Arguments<typeof implementation.updateCell>) =>
  backendCall(() => implementation.updateCell(commandDependencies(), ...args));
export const updateCells = (...args: Arguments<typeof implementation.updateCells>) =>
  backendCall(() => implementation.updateCells(commandDependencies(), ...args));
export const updateCellsInTransaction = (...args: Arguments<typeof implementation.updateCellsInTransaction>) =>
  backendCall(() => implementation.updateCellsInTransaction(commandDependencies(), ...args));
export const setRelation = (...args: Arguments<typeof implementation.setRelation>) =>
  backendCall(() => implementation.setRelation(commandDependencies(), ...args));
export const addRelation = (...args: Arguments<typeof implementation.addRelation>) =>
  backendCall(() => implementation.addRelation(commandDependencies(), ...args));
export const removeRelation = (...args: Arguments<typeof implementation.removeRelation>) =>
  backendCall(() => implementation.removeRelation(commandDependencies(), ...args));
export const addRow = (...args: Arguments<typeof implementation.addRow>) =>
  backendCall(() => implementation.addRow(commandDependencies(), ...args));
export const batchAddRows = (...args: Arguments<typeof implementation.batchAddRows>) =>
  backendCall(() => implementation.batchAddRows(commandDependencies(), ...args));
export const prepareBatchRowWrites = (...args: Arguments<typeof implementation.prepareBatchRowWrites>) =>
  backendCall(() => implementation.prepareBatchRowWrites(commandDependencies(), ...args));
export const batchUpdateRows = (...args: Arguments<typeof implementation.batchUpdateRows>) =>
  backendCall(() => implementation.batchUpdateRows(commandDependencies(), ...args));
export const deleteRow = (...args: Arguments<typeof implementation.deleteRow>) =>
  backendCall(() => implementation.deleteRow(commandDependencies(), ...args));
export const batchDeleteRows = (...args: Arguments<typeof implementation.batchDeleteRows>) =>
  backendCall(() => implementation.batchDeleteRows(commandDependencies(), ...args));
export const deleteTable = (...args: Arguments<typeof implementation.deleteTable>) =>
  backendCall(() => implementation.deleteTable(commandDependencies(), ...args));
export const reorderColumns = (...args: Arguments<typeof implementation.reorderColumns>) =>
  backendCall(() => implementation.reorderColumns(commandDependencies(), ...args));
export const queryRows = (...args: Arguments<typeof implementation.queryRows>) =>
  backendCall(() => implementation.queryRows(commandDependencies(), ...args));
export const setStatus = (...args: Arguments<typeof implementation.setStatus>) =>
  backendCall(() => implementation.setStatus(commandDependencies(), ...args));
export type { OrgScoped } from "@tabdo/backend/commands";
export const moveCard = (...args: Arguments<typeof implementation.moveCard>) =>
  backendCall(() => implementation.moveCard(commandDependencies(), ...args));
export const listAutomations = (...args: Arguments<typeof implementation.listAutomations>) =>
  backendCall(() => implementation.listAutomations(commandDependencies(), ...args));
export const createAutomation = (...args: Arguments<typeof implementation.createAutomation>) =>
  backendCall(() => implementation.createAutomation(commandDependencies(), ...args));
export const updateAutomation = (...args: Arguments<typeof implementation.updateAutomation>) =>
  backendCall(() => implementation.updateAutomation(commandDependencies(), ...args));
export const deleteAutomation = (...args: Arguments<typeof implementation.deleteAutomation>) =>
  backendCall(() => implementation.deleteAutomation(commandDependencies(), ...args));
export const listAutomationRuns = (...args: Arguments<typeof implementation.listAutomationRuns>) =>
  backendCall(() => implementation.listAutomationRuns(commandDependencies(), ...args));
export { getWorkspace, listMembers } from "./workspace.js";
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
