import "../load-env.js";
import { client } from "./index.js";
import {
  seedDemoUser,
  seedRichDemoWorkspace,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_BACKLOG_NAME,
  DEMO_CRM_NAME,
  DEMO_AGENT_NAME,
  DEMO_REPORT_NAME,
} from "./seed-demo.js";

async function seed() {
  const demo = await seedDemoUser();
  console.log(
    demo.created
      ? "Demo user created."
      : "Demo user already present (password refreshed)."
  );
  console.log("Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);

  const rich = await seedRichDemoWorkspace(demo.organizationId);
  console.log("Rich demo workspace ready:");
  console.log(`  ${DEMO_BACKLOG_NAME}: ${rich.backlogTableId} (${rich.backlogRows} rows)`);
  console.log(`  ${DEMO_CRM_NAME}: ${rich.crmTableId} (${rich.crmRows} rows)`);
  console.log(`  automations: ${rich.automations}`);
  console.log(`  agent: ${DEMO_AGENT_NAME}`);
  console.log(`  report: ${DEMO_REPORT_NAME} (${rich.reportId})`);
  await client.end();
}

seed().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
