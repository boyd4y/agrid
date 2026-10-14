import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const password = randomBytes(24).toString("hex");
const configuration = [
  "# Generated local-only configuration. Do not commit or share.",
  `LOCAL_DATABASE_PASSWORD=${password}`,
  "LOCAL_DATABASE_PORT=55441",
  "LOCAL_REDIS_PORT=6394",
  `DATABASE_URL=postgresql://tableapp:${password}@127.0.0.1:55441/tabdo_local`,
  "REDIS_URL=redis://127.0.0.1:6394",
  "QUEUE_PREFIX=tabdo-node-local",
  "PORT=3301",
  "HOST=127.0.0.1",
  "APP_URL=http://localhost:3301",
  "BETTER_AUTH_URL=http://localhost:3301",
  `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  `INTEGRATION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  "AUTH_REQUIRED=true",
  "FILE_STORAGE_DRIVER=local",
  `FILE_STORAGE_LOCAL_DIR=${fileURLToPath(new URL("data/files", root))}`,
  "NATIVE_EXECUTION_ADAPTER=embedded",
  "",
].join("\n");
try {
  await writeFile(new URL(".env", root), configuration, { flag: "wx", mode: 0o600 });
  console.log("Created .env with private local configuration. Model providers can be configured there.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Existing .env preserved; check the local database/Redis ports before starting.");
}
