export type SystemServices = Readonly<{ now(): Date; uuid(): string }>;

/** Construct defaults at the application boundary; callers can supply deterministic services. */
export function createSystemServices(overrides: Partial<SystemServices> = {}): SystemServices {
  return Object.freeze({ now: overrides.now ?? (() => new Date()), uuid: overrides.uuid ?? (() => crypto.randomUUID()) });
}
