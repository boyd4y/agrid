import { withNodeResources } from "../resources/node.js";
import { client } from "../db/index.js";
import { automationQueueStatus } from "../automation/jobs/status.js";

await withNodeResources(async () => {
  try { console.log(JSON.stringify(await automationQueueStatus(), null, 2)); }
  finally { await client.end(); }
});
