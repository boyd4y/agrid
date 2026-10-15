import { persistDelivery as persist } from "../business/integrations/deliveries.js";
import { integrationDependencies } from "./dependencies.js";
import { businessCall } from "../services/dependencies.js";
type Arguments = Parameters<typeof persist> extends [unknown, ...infer Rest] ? Rest : never;
export const persistDelivery = (...args: Arguments) => businessCall(() => persist(integrationDependencies(), ...args));
