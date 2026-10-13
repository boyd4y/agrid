import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(__dirname, "../../../.env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
];

for (const envPath of envCandidates) {
  const result = loadEnv({ path: envPath, override: false });
  if (result.parsed && Object.keys(result.parsed).length > 0) break;
}
