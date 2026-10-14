import { readFile } from "node:fs/promises";
const [token, pid] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(token) || !/^\d+$/.test(pid)) process.exit(2);
const marker = JSON.parse(await readFile(`/tmp/launch-${token}.json`, "utf8"));
// Local Container ExecProcess.pid identifies its host execution process and is
// not Linux process.pid inside the container. Reconcile the token-bound marker.
const active = marker.launchToken === token;
try { process.kill(marker.pid,0); }
catch { process.exit(3); }
process.stdout.write(JSON.stringify({ ...marker, active }));
