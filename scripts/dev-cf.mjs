import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfiguration, settings, prepareLocalFiles } from "./lib/cf-dev.mjs";

const root = fileURLToPath(new URL("../",import.meta.url));
const run = promisify(execFile);
async function freePort(number) {
  const server = createServer();
  try { await new Promise((accept,reject) => { server.once("error",reject);server.listen(number,"0.0.0.0",accept); }); }
  catch { throw new Error(`Port ${number} is already in use; stop that development process or set CF_CLIENT_PORT / CF_WORKER_PORT / CF_INSPECTOR_PORT`); }
  finally { if (server.listening) await new Promise(accept => server.close(accept)); }
}
async function main() {
  const configuration = await loadConfiguration(root);
  const values = settings(configuration);
  if (process.argv.includes("--migrate")) {
    const child = spawn(process.execPath,[resolve(root,"apps/server/node_modules/tsx/dist/cli.mjs"),"src/db/migrate.ts"],{ cwd:resolve(root,"apps/server"),env:{...process.env,DATABASE_URL:values.database},stdio:"inherit" });
    await new Promise((accept,reject) => { child.once("error",reject);child.once("close",code => code === 0 ? accept() : reject(new Error("CF PostgreSQL migration failed"))); });
    return;
  }
  const require = createRequire(resolve(root,"apps/cloudflare/package.json"));
  const { default: postgres } = await import(pathToFileURL(require.resolve("postgres")).href);
  const database = postgres(values.database,{max:1,connect_timeout:5,idle_timeout:0});
  try {
    const [schema] = await database`select to_regclass('public.user') is not null and to_regclass('public.tables') is not null and to_regclass('public.agent_execution_gateways') is not null as ready`;
    if (!schema.ready) throw new Error("SCHEMA_MISSING");
  } catch (error) {
    if (error.message === "SCHEMA_MISSING") throw new Error("PostgreSQL needs migrations. Run pnpm cf:db:migrate, then pnpm dev:cf.");
    throw new Error("Cannot connect to PostgreSQL. Check DATABASE_URL in .env / .env.cf and start your database.");
  } finally { await database.end({timeout:2}); }
  try { await run("docker",["info","--format","{{.ServerVersion}}"],{ timeout: 15000 }); }
  catch { throw new Error("Docker Engine must be running for Cloudflare Sandbox. Start Docker Desktop or Colima, then rerun pnpm dev:cf."); }
  await Promise.all([values.clientPort,values.workerPort,values.inspectorPort].map(freePort));
  const local = await prepareLocalFiles(root,values);
  if (process.argv.includes("--check")) { console.log("CF development configuration and Docker are ready. PostgreSQL schema is ready.");return; }
  const processes = [];
  let closing = false;
  let scheduledTimer;
  const scheduledAbort = new AbortController();
  let scheduledBusy = false;
  async function simulateCron() {
    if (closing || scheduledBusy) return;
    scheduledBusy = true;
    try {
      const response = await fetch(`http://127.0.0.1:${values.workerPort}/__scheduled?cron=${encodeURIComponent("* * * * *")}`, {signal:AbortSignal.any([scheduledAbort.signal,AbortSignal.timeout(30000)])});
      await response.body?.cancel();
      if (!response.ok) console.warn("Local Cloudflare Cron failed; check Wrangler output.");
    } catch { /* Wrangler may still be starting. Retry on the next tick. */ }
    finally { scheduledBusy = false; }
  }
  async function shutdown(code = 0) {
    if (closing) return;
    closing = true;scheduledAbort.abort();clearInterval(scheduledTimer);process.exitCode = code;
    await Promise.all(processes.map(child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      return new Promise(accept => {
        const timer = setTimeout(() => { try { process.kill(-child.pid,"SIGKILL"); } catch {} },10000);
        timer.unref();
        child.once("close",() => { clearTimeout(timer);accept(); });
        try { process.kill(-child.pid,"SIGTERM"); } catch { child.kill("SIGTERM"); }
      });
    }));
  }
  function launch(args,cwd,env) {
    const child = spawn(process.execPath,args,{ cwd,env,stdio:"inherit",detached:process.platform!=="win32" });
    processes.push(child);
    child.on("error",error => { console.error(error.message);void shutdown(1); });
    child.on("exit",code => { if (!closing) void shutdown(code || 1); });
  }
  const inherited = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false" };
  launch([resolve(root,"apps/cloudflare/node_modules/wrangler/bin/wrangler.js"),"dev","--local","--test-scheduled","--config",local.configPath,
    "--persist-to",local.statePath,"--ip","0.0.0.0","--port",String(values.workerPort),"--inspector-port",String(values.inspectorPort),"--show-interactive-dev-session=false"],
    root,{ ...inherited, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DATABASE:values.database });
  launch([resolve(root,"apps/client/node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(values.clientPort),"--strictPort"],
    resolve(root,"apps/client"),{ ...inherited, TABDO_API_TARGET:`http://127.0.0.1:${values.workerPort}` });
  console.log(`CF development: http://localhost:${values.clientPort} → Wrangler :${values.workerPort}. Sandbox starts on demand. Ctrl+C stops both.`);
  scheduledTimer = setInterval(() => void simulateCron(),60000);
  process.on("SIGTERM",() => void shutdown());process.on("SIGINT",() => void shutdown());
}
main().catch(error => { console.error(error.message);process.exitCode=1; });
