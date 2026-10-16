import { superviseApi } from "../../src/dev-supervisor.js";

const [entry, cwd, watched] = process.argv.slice(2);
const supervisor = superviseApi({
  entry, cwd, watchPaths: [watched], env: { PATH: process.env.PATH, NODE_ENV: "test" },
  onFailure: code => { process.exitCode = code; void shutdown(); },
});
let closing: Promise<void> | undefined;
function shutdown() {
  return closing ??= (async () => {
    process.send?.({ fixturePhase: "supervisor drain begin" });
    await supervisor.shutdown();
    process.send?.({ fixturePhase: "supervisor drain end" });
    if (process.connected) process.disconnect();
  })();
}
process.on("message", message => { if (message === "shutdown") void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.send?.({ fixturePhase: "supervisor ready" });
