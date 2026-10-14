import * as implementation from "@tabdo/backend/storage/files";
import { commandDependencies, backendCall } from "../services/backend-facade.js";

type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;

export const assertFileReferences = (...args: Arguments<typeof implementation.assertFileReferences>) =>
  backendCall(() => implementation.assertFileReferences(commandDependencies(), ...args));
export { storedFile } from "@tabdo/backend/storage/files";
