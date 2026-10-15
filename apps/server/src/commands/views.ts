import * as implementation from "../business/commands/views.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const renameView = (...args: Arguments<typeof implementation.renameView>) =>
  businessCall(() => implementation.renameView(commandDependencies(), ...args));
export const setDefaultView = (...args: Arguments<typeof implementation.setDefaultView>) =>
  businessCall(() => implementation.setDefaultView(commandDependencies(), ...args));
export const updateBoardView = (...args: Arguments<typeof implementation.updateBoardView>) =>
  businessCall(() => implementation.updateBoardView(commandDependencies(), ...args));
export const listViews = (...args: Arguments<typeof implementation.listViews>) =>
  businessCall(() => implementation.listViews(commandDependencies(), ...args));
export const getView = (...args: Arguments<typeof implementation.getView>) =>
  businessCall(() => implementation.getView(commandDependencies(), ...args));
export const deleteView = (...args: Arguments<typeof implementation.deleteView>) =>
  businessCall(() => implementation.deleteView(commandDependencies(), ...args));
export const createGridView = (...args: Arguments<typeof implementation.createGridView>) =>
  businessCall(() => implementation.createGridView(commandDependencies(), ...args));
export const createBoardView = (...args: Arguments<typeof implementation.createBoardView>) =>
  businessCall(() => implementation.createBoardView(commandDependencies(), ...args));
export const createFormView = (...args: Arguments<typeof implementation.createFormView>) =>
  businessCall(() => implementation.createFormView(commandDependencies(), ...args));
export const updateFormView = (...args: Arguments<typeof implementation.updateFormView>) =>
  businessCall(() => implementation.updateFormView(commandDependencies(), ...args));
export const setFormFields = (...args: Arguments<typeof implementation.setFormFields>) =>
  businessCall(() => implementation.setFormFields(commandDependencies(), ...args));
export const addFormField = (...args: Arguments<typeof implementation.addFormField>) =>
  businessCall(() => implementation.addFormField(commandDependencies(), ...args));
export const removeFormField = (...args: Arguments<typeof implementation.removeFormField>) =>
  businessCall(() => implementation.removeFormField(commandDependencies(), ...args));
export const reorderFormFields = (...args: Arguments<typeof implementation.reorderFormFields>) =>
  businessCall(() => implementation.reorderFormFields(commandDependencies(), ...args));
export const setFormSections = (...args: Arguments<typeof implementation.setFormSections>) =>
  businessCall(() => implementation.setFormSections(commandDependencies(), ...args));
export const setFormTheme = (...args: Arguments<typeof implementation.setFormTheme>) =>
  businessCall(() => implementation.setFormTheme(commandDependencies(), ...args));
export const setFormLayout = (...args: Arguments<typeof implementation.setFormLayout>) =>
  businessCall(() => implementation.setFormLayout(commandDependencies(), ...args));
export const setFormFieldSettings = (...args: Arguments<typeof implementation.setFormFieldSettings>) =>
  businessCall(() => implementation.setFormFieldSettings(commandDependencies(), ...args));
export const setFormChrome = (...args: Arguments<typeof implementation.setFormChrome>) =>
  businessCall(() => implementation.setFormChrome(commandDependencies(), ...args));
export const ensureDemoFormView = (...args: Arguments<typeof implementation.ensureDemoFormView>) =>
  businessCall(() => implementation.ensureDemoFormView(commandDependencies(), ...args));
export type { OrgScoped } from "../business/commands/views.js";
