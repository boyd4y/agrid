import * as implementation from "../business/storage/files.js";
import { commandDependencies, businessCall } from "../services/dependencies.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const assertFileReferences = (...args: Arguments<typeof implementation.assertFileReferences>) =>
  businessCall(() => implementation.assertFileReferences(commandDependencies(), ...args));
export { storedFile } from "../business/storage/files.js";
