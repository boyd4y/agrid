import { asSchema } from "ai";
import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import { z } from "zod";
import { executeSandboxRun } from "./execute.js";

async function main() {
let raw = "";
for await (const bytes of process.stdin) {
  raw += bytes;
  if (Buffer.byteLength(raw) > 512 * 1024) throw new Error("Sandbox input too large");
}
const input: unknown = JSON.parse(raw);
if (process.argv.includes("--validate-questions")) {
  // The same official tool definitions used by the native Harness own validation.
  const { pairs } = z.object({ pairs: z.array(z.object({ input: z.unknown(), output: z.unknown() }).strict()).max(100) }).strict().parse(input);
  const validated = [];
  for (const pair of pairs) {
    const question = await asSchema(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.inputSchema).validate?.(pair.input);
    const answer = await asSchema(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.outputSchema!).validate?.(pair.output);
    if (!question?.success || !answer?.success) throw new Error("Invalid official question schema");
    validated.push({ input: question.value, output: answer.value });
  }
  process.stdout.write(JSON.stringify({ pairs: validated }));
} else {
  for (const name of ["DATABASE_URL", "PGPASSWORD", "REDIS_URL", "BETTER_AUTH_SECRET"]) {
    if (process.env[name]) throw new Error("Sandbox must not receive administrative credentials");
  }
  const launch = z.object({ executionId: z.uuid(), launchToken: z.uuid(), token: z.string().min(64).max(256), gatewayUrl: z.url() }).strict().parse(input);
  await executeSandboxRun(launch, process.env);
}

}
try { await main(); }
catch { process.stderr.write("Native sandbox execution failed; inspect the private Run record.\n");process.exitCode = 1; }
// Official pending-client bridges may keep handles alive. Checkpoints and output
// have already been awaited; a fresh process restores the opaque SDK journal.
process.exit(process.exitCode ?? 0);
