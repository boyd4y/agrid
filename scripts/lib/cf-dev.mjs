import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve, dirname, isAbsolute } from "node:path";

export const modelKeys = ["PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "PI_CONTEXT_WINDOW", "PI_MAX_OUTPUT_TOKENS",
  "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_MODEL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_MODEL", "AI_CHAT_MAX_STEPS", "AI_CHAT_TOTAL_MS", "AI_CHAT_STEP_MS", "AI_CHAT_FIRST_CHUNK_MS", "AI_CHAT_CHUNK_MS", "AI_RUN_POLL_MS"];

export async function loadConfiguration(root, inherited = process.env) {
  const configuration = {};
  for (const name of [".env", ".env.cf"]) {
    try { Object.assign(configuration, parseEnv(await readFile(resolve(root, name), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { ...configuration, ...inherited };
}
export function port(value, fallback, name) {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535) throw new Error(`${name} must be an integer between 1 and 65535`);
  return number;
}
export function settings(configuration) {
  const clientPort = port(configuration.CF_CLIENT_PORT, 5173, "CF_CLIENT_PORT");
  const workerPort = port(configuration.CF_WORKER_PORT, 8787, "CF_WORKER_PORT");
  const inspectorPort = port(configuration.CF_INSPECTOR_PORT, 9231, "CF_INSPECTOR_PORT");
  if (new Set([clientPort,workerPort,inspectorPort]).size !== 3) throw new Error("CF development ports must be different");
  const database = configuration.DATABASE_URL;
  if (!database) throw new Error("Set DATABASE_URL in .env or .env.cf to your existing PostgreSQL database");
  try { if (!["postgres:","postgresql:"].includes(new URL(database).protocol)) throw new Error(); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection string"); }
  const variables = { APP_URL: `http://localhost:${clientPort}`, BETTER_AUTH_URL: `http://localhost:${clientPort}`,
    GATEWAY_ORIGIN: configuration.CF_GATEWAY_ORIGIN || `http://host.docker.internal:${workerPort}`, ENVIRONMENT: "development" };
  for (const key of modelKeys) if (configuration[key]) variables[key] = configuration[key];
  if (configuration.DEEPSEEK_API_KEY && !variables.PI_API_KEY) {
    variables.PI_API_KEY = configuration.DEEPSEEK_API_KEY;
    variables.PI_BASE_URL = configuration.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    variables.PI_MODEL = configuration.DEEPSEEK_MODEL || "deepseek-flash";
    variables.PI_CONTEXT_WINDOW ||= "1048576";
  }
  for (const key of ["RESEND_API_KEY","EMAIL_FROM","INTEGRATION_ENCRYPTION_KEY"]) if (configuration[key]) variables[key] = configuration[key];
  const auth = configuration.BETTER_AUTH_SECRET;
  if (auth && auth.trim().length >= 32 && auth !== "dev-only-secret-change-me-32chars-min!!") variables.BETTER_AUTH_SECRET = auth;
  return { clientPort, workerPort, inspectorPort, database, variables };
}
function dotenvValue(key, value) {
  // dotenv does not understand JSON's escaped quotes. Choose a delimiter absent
  // from the value; double quotes also expand backslash sequences in dotenv.
  if (typeof value === "string" && !/[\r\n\0]/.test(value)) {
    for (const quote of ["'", "`", '"']) {
      if (!value.includes(quote) && !(quote === '"' && value.includes("\\"))) return `${quote}${value}${quote}`;
    }
  }
  throw new Error(`Unsupported CF development variable ${key}: use a single-line value with a safe dotenv delimiter`);
}
export async function prepareLocalFiles(root, values) {
  const directory = resolve(root, ".local/cf");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const secretPath = resolve(directory,"secrets.json");
  let secrets;
  try { secrets = JSON.parse(await readFile(secretPath,"utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error;secrets = { BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"), INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    await writeFile(secretPath,JSON.stringify(secrets), { mode: 0o600, flag: "wx" }); }
  for (const key of ["BETTER_AUTH_SECRET","INTEGRATION_ENCRYPTION_KEY"]) {
    if (typeof secrets[key] !== "string" || secrets[key].length < 32) throw new Error("Invalid private CF development secrets file");
  }
  const variables = { ...secrets, ...values.variables };
  const devVars = Object.entries(variables).map(([key,value]) => `${key}=${dotenvValue(key, value)}`).join("\n")+"\n";
  await writeFile(resolve(directory,".dev.vars"),devVars,{ mode: 0o600 });
  await chmod(resolve(directory,".dev.vars"),0o600);
  const original = resolve(root,"apps/cloudflare/wrangler.jsonc");
  const config = JSON.parse(await readFile(original,"utf8"));
  // Wrangler treats secrets.required as a local binding allowlist. Include only
  // the explicitly selected variables, never the inherited process environment.
  config.secrets = { required: Object.keys(variables).filter(key => !(key in (config.vars ?? {}))) };
  const base = dirname(original);
  config.main = resolve(base,config.main);
  for (const container of config.containers ?? []) for (const image of Object.values(container.images ?? {})) {
    if (image.dockerfile && !isAbsolute(image.dockerfile)) image.dockerfile = resolve(base,image.dockerfile);
    if (image.build_context && !isAbsolute(image.build_context)) image.build_context = resolve(base,image.build_context);
  }
  await writeFile(resolve(directory,"wrangler.jsonc"),JSON.stringify(config,null,2)+"\n",{ mode: 0o600 });
  return { directory, configPath: resolve(directory,"wrangler.jsonc"), statePath: resolve(directory,"state") };
}
