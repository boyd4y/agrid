import { persistDelivery as persist } from "@tabdo/backend/integrations/deliveries";
import { integrationDependencies } from "./dependencies.js";
import { backendCall } from "../services/backend-facade.js";
type Arguments = Parameters<typeof persist> extends [unknown, ...infer Rest] ? Rest : never;
export const persistDelivery = (...args: Arguments) => backendCall(() => persist(integrationDependencies(), ...args));
