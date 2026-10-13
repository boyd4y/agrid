/** Process lifecycle only. Durable Run state and ownership remain in the database. */
const active = new Set<symbol>();
const idleWaiters = new Set<() => void>();
let draining = false;

function publish() {
  if (process.connected) process.send?.({ type: "tabdo:native-runs", count: active.size }, () => {});
}

export function registerNativeRun() {
  const token = Symbol();
  active.add(token); publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(token); publish();
    if (!active.size) for (const resolve of idleWaiters) resolve();
    if (!active.size) idleWaiters.clear();
  };
}

export function beginNativeDrain() { draining = true; }
export function nativeDrainStarted() { return draining; }
export function activeNativeRunCount() { return active.size; }
export function waitForNativeDrain(): Promise<void> {
  return active.size ? new Promise((resolve) => idleWaiters.add(resolve)) : Promise.resolve();
}
