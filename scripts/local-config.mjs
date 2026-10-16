import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const configuration = [
  "# Generated local-only configuration. Do not commit or share.",
  "DATABASE_URL=postgresql://tableapp:tableapp@127.0.0.1:5432/tableapp",
  "REDIS_URL=redis://127.0.0.1:6380",
  "QUEUE_PREFIX=tabdo-development",
  "PORT=3001",
  "HOST=127.0.0.1",
  "APP_URL=http://localhost:5173",
  "BETTER_AUTH_URL=http://localhost:3001",
  `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  `INTEGRATION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  "AUTH_REQUIRED=true",
  "FILE_STORAGE_DRIVER=local",
  `FILE_STORAGE_LOCAL_DIR=${fileURLToPath(new URL("data/files", root))}`,
  "",
].join("\n");
try {
  await writeFile(new URL(".env.development", root), configuration, { flag: "wx", mode: 0o600 });
  console.log("Created .env.development with private local configuration. Model providers can be configured there.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Existing .env.development preserved; check the local database/Redis ports before starting.");
}
