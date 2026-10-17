export * from "./calendar.js";
import * as calendarCommands from "./calendar.js";
/** Shared command registry. Implementations depend on modules, never on this registry. */
export * from "./rows.js";
import { listTables, getTable, createTable, updateCell, updateCells, updateCellsInTransaction, setRelation, addRelation, removeRelation, addRow, batchAddRows, prepareBatchRowWrites, batchUpdateRows, deleteRow, batchDeleteRows, deleteTable, reorderColumns, queryRows, setStatus, moveCard } from "./rows.js";

export { getWorkspace, listWorkspaces, createWorkspace, listMembers } from "./workspace.js";
import { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
export { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
import { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
export { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
import * as automationCrud from "../automation/crud.js";

export const listAutomations = automationCrud.listAutomations;
export const createAutomation = automationCrud.createAutomation;
export const updateAutomation = automationCrud.updateAutomation;
export const deleteAutomation = automationCrud.deleteAutomation;
export const listAutomationRuns = automationCrud.listAutomationRuns;

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
import * as viewCmds from "./views.js";

export { getRow, queryRelationRecords } from "./relations.js";
import { getRow, queryRelationRecords } from "./relations.js";

export const commands = {
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

export { listSites, getSite, saveSite, restoreSiteRevision, publishSite, unpublishSite, deleteSite } from "../sites/service.js";
