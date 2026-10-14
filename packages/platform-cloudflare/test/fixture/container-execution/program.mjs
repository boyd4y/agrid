import { readFile, writeFile } from "node:fs/promises";
let stdin = "";
for await (const bytes of process.stdin) stdin += bytes;
const request = JSON.parse(stdin);
if (typeof request.launchToken !== "string" || !/^[a-f0-9-]{36}$/.test(request.launchToken)) process.exit(2);
const counterPath = "/tmp/launch-count";
const count = Number(await readFile(counterPath,"utf8").catch(() => "0")) + 1;
await writeFile(counterPath, String(count));
await writeFile(`/tmp/launch-${request.launchToken}.json`, JSON.stringify({
  id: request.id, launchToken: request.launchToken, pid: process.pid, count,
  limitedEnvironment: process.env.LIMITED_CONTEXT, reference: request.reference,
}));
await new Promise(resolve => setTimeout(resolve, 15000));
process.exit(0);
