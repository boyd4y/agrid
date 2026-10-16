import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";

/** Test-only declaration of absent optional brokering; the SDK owns forwarding. */
export function withoutRequestTransformations(session: HarnessV1NetworkSandboxSession): HarnessV1NetworkSandboxSession {
  const hidden = new Set<PropertyKey>(["addRequestTransformations", "setRequestTransformations"]);
  return new Proxy(session, {
    has: (target, key) => !hidden.has(key) && Reflect.has(target, key),
    get: (target, key) => {
      if (hidden.has(key)) return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
