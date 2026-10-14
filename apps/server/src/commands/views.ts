import * as implementation from "@tabdo/backend/commands/views";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const renameView = (...args: Arguments<typeof implementation.renameView>) =>
  backendCall(() => implementation.renameView(commandDependencies(), ...args));
export const setDefaultView = (...args: Arguments<typeof implementation.setDefaultView>) =>
  backendCall(() => implementation.setDefaultView(commandDependencies(), ...args));
export const updateBoardView = (...args: Arguments<typeof implementation.updateBoardView>) =>
  backendCall(() => implementation.updateBoardView(commandDependencies(), ...args));
export const listViews = (...args: Arguments<typeof implementation.listViews>) =>
  backendCall(() => implementation.listViews(commandDependencies(), ...args));
export const getView = (...args: Arguments<typeof implementation.getView>) =>
  backendCall(() => implementation.getView(commandDependencies(), ...args));
export const deleteView = (...args: Arguments<typeof implementation.deleteView>) =>
  backendCall(() => implementation.deleteView(commandDependencies(), ...args));
export const createGridView = (...args: Arguments<typeof implementation.createGridView>) =>
  backendCall(() => implementation.createGridView(commandDependencies(), ...args));
export const createBoardView = (...args: Arguments<typeof implementation.createBoardView>) =>
  backendCall(() => implementation.createBoardView(commandDependencies(), ...args));
export const createFormView = (...args: Arguments<typeof implementation.createFormView>) =>
  backendCall(() => implementation.createFormView(commandDependencies(), ...args));
export const updateFormView = (...args: Arguments<typeof implementation.updateFormView>) =>
  backendCall(() => implementation.updateFormView(commandDependencies(), ...args));
export const setFormFields = (...args: Arguments<typeof implementation.setFormFields>) =>
  backendCall(() => implementation.setFormFields(commandDependencies(), ...args));
export const addFormField = (...args: Arguments<typeof implementation.addFormField>) =>
  backendCall(() => implementation.addFormField(commandDependencies(), ...args));
export const removeFormField = (...args: Arguments<typeof implementation.removeFormField>) =>
  backendCall(() => implementation.removeFormField(commandDependencies(), ...args));
export const reorderFormFields = (...args: Arguments<typeof implementation.reorderFormFields>) =>
  backendCall(() => implementation.reorderFormFields(commandDependencies(), ...args));
export const setFormSections = (...args: Arguments<typeof implementation.setFormSections>) =>
  backendCall(() => implementation.setFormSections(commandDependencies(), ...args));
export const setFormTheme = (...args: Arguments<typeof implementation.setFormTheme>) =>
  backendCall(() => implementation.setFormTheme(commandDependencies(), ...args));
export const setFormLayout = (...args: Arguments<typeof implementation.setFormLayout>) =>
  backendCall(() => implementation.setFormLayout(commandDependencies(), ...args));
export const setFormFieldSettings = (...args: Arguments<typeof implementation.setFormFieldSettings>) =>
  backendCall(() => implementation.setFormFieldSettings(commandDependencies(), ...args));
export const setFormChrome = (...args: Arguments<typeof implementation.setFormChrome>) =>
  backendCall(() => implementation.setFormChrome(commandDependencies(), ...args));
export const ensureDemoFormView = (...args: Arguments<typeof implementation.ensureDemoFormView>) =>
  backendCall(() => implementation.ensureDemoFormView(commandDependencies(), ...args));
export type { OrgScoped } from "@tabdo/backend/commands/views";
