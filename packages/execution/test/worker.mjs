import { runNodeExecution } from "../dist/adapters/node-worker.js";
await runNodeExecution(async ({ reference }, signal) => {
  if (reference.wait) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
  else process.stdout.write(reference.message);
});
process.exit(0);
