/**
 * Seed TWO tenants (organizations) with isolated scheme-2 tables,
 * then verify list/get cannot cross orgs.
 *
 * Usage: pnpm --filter @tabdo/server db:seed:tenants
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, client } from "./index.js";
import {
  user,
  account,
  organization,
  member,
  tables,
  columns,
  rows,
} from "./schema.js";
import { listTables, getTable } from "../commands/index.js";
import {
  seedDemoUser,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_ORG_SLUG,
} from "./seed-demo.js";

export const TENANT_B_EMAIL = "acme@agrid.app";
export const TENANT_B_PASSWORD = "Acme1234!";
export const TENANT_B_ORG_SLUG = "acme-workspace";
export const TENANT_B_ORG_NAME = "Acme Workspace";
export const TENANT_B_NAME = "Acme Owner";

async function ensureUser(opts: {
  email: string;
  password: string;
  name: string;
}) {
  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, opts.email))
    .limit(1);
  let userId: string;
  let created = false;
  const hashed = await hashPassword(opts.password);
  if (existing) {
    userId = existing.id;
    const [cred] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .limit(1);
    if (cred) {
      await db
        .update(account)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(account.id, cred.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hashed,
      });
    }
  } else {
    userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      name: opts.name,
      email: opts.email,
      emailVerified: true,
      kind: "human",
    });
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashed,
    });
    created = true;
  }
  return { userId, created };
}

async function ensureOrg(opts: {
  slug: string;
  name: string;
  ownerUserId: string;
}) {
  let [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, opts.slug))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organization)
      .values({ id: randomUUID(), name: opts.name, slug: opts.slug })
      .returning();
  }
  const [mem] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, opts.ownerUserId), eq(member.organizationId, org.id))
    )
    .limit(1);
  if (!mem) {
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: opts.ownerUserId,
      role: "owner",
    });
  }
  return org;
}

async function ensureTenantTable(opts: {
  organizationId: string;
  name: string;
  description: string;
  markerTitle: string;
}) {
  const existing = await db
    .select()
    .from(tables)
    .where(
      and(eq(tables.organizationId, opts.organizationId), eq(tables.name, opts.name))
    )
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const [table] = await db
    .insert(tables)
    .values({
      organizationId: opts.organizationId,
      name: opts.name,
      description: opts.description,
    })
    .returning();

  const [titleCol] = await db
    .insert(columns)
    .values({
      tableId: table.id,
      name: "标题",
      type: "text",
      sortOrder: 0,
      width: 220,
    })
    .returning();

  await db.insert(rows).values({
    tableId: table.id,
    sortOrder: 0,
    cells: { [titleCol.id]: opts.markerTitle },
  });

  return table;
}

export async function seedTwoTenants() {
  // Tenant A — demo workspace (reuse seedDemoUser)
  const demo = await seedDemoUser();
  const tableA = await ensureTenantTable({
    organizationId: demo.organizationId,
    name: "产品需求看板",
    description: "Tenant A demo board",
    markerTitle: "TENANT_A_ONLY_ROW",
  });

  // Tenant B — acme
  const bUser = await ensureUser({
    email: TENANT_B_EMAIL,
    password: TENANT_B_PASSWORD,
    name: TENANT_B_NAME,
  });
  const orgB = await ensureOrg({
    slug: TENANT_B_ORG_SLUG,
    name: TENANT_B_ORG_NAME,
    ownerUserId: bUser.userId,
  });
  const tableB = await ensureTenantTable({
    organizationId: orgB.id,
    name: "Acme CRM",
    description: "Tenant B private CRM",
    markerTitle: "TENANT_B_ONLY_ROW",
  });

  return {
    tenantA: {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      organizationId: demo.organizationId,
      slug: DEMO_ORG_SLUG,
      tableId: tableA.id,
      tableName: tableA.name,
    },
    tenantB: {
      email: TENANT_B_EMAIL,
      password: TENANT_B_PASSWORD,
      organizationId: orgB.id,
      slug: TENANT_B_ORG_SLUG,
      tableId: tableB.id,
      tableName: tableB.name,
    },
  };
}

export async function verifyTenantIsolation(seed: Awaited<ReturnType<typeof seedTwoTenants>>) {
  const { tenantA, tenantB } = seed;
  const errors: string[] = [];

  const listA = await listTables({ organizationId: tenantA.organizationId });
  const listB = await listTables({ organizationId: tenantB.organizationId });
  const idsA = new Set(listA.map((t) => t.id));
  const idsB = new Set(listB.map((t) => t.id));

  if (!idsA.has(tenantA.tableId)) {
    errors.push(`A list missing own table ${tenantA.tableId}`);
  }
  if (!idsB.has(tenantB.tableId)) {
    errors.push(`B list missing own table ${tenantB.tableId}`);
  }
  if (idsA.has(tenantB.tableId)) {
    errors.push(`LEAK: A list contains B table ${tenantB.tableId}`);
  }
  if (idsB.has(tenantA.tableId)) {
    errors.push(`LEAK: B list contains A table ${tenantA.tableId}`);
  }

  // Cross getTable must fail as not found
  try {
    await getTable({
      tableId: tenantB.tableId,
      organizationId: tenantA.organizationId,
    });
    errors.push(`LEAK: A can getTable B (${tenantB.tableId})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("不存在")) {
      errors.push(`A cross-get unexpected error: ${msg}`);
    }
  }

  try {
    await getTable({
      tableId: tenantA.tableId,
      organizationId: tenantB.organizationId,
    });
    errors.push(`LEAK: B can getTable A (${tenantA.tableId})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("不存在")) {
      errors.push(`B cross-get unexpected error: ${msg}`);
    }
  }

  // Own get works
  const fullA = await getTable({
    tableId: tenantA.tableId,
    organizationId: tenantA.organizationId,
  });
  const fullB = await getTable({
    tableId: tenantB.tableId,
    organizationId: tenantB.organizationId,
  });
  if (fullA.organizationId !== tenantA.organizationId) {
    errors.push("fullA.organizationId mismatch");
  }
  if (fullB.organizationId !== tenantB.organizationId) {
    errors.push("fullB.organizationId mismatch");
  }

  // DB-level: each table row has correct org
  const dbCheck = await db
    .select({ id: tables.id, organizationId: tables.organizationId, name: tables.name })
    .from(tables)
    .where(inArray(tables.id, [tenantA.tableId, tenantB.tableId]));
  for (const row of dbCheck) {
    if (row.id === tenantA.tableId && row.organizationId !== tenantA.organizationId) {
      errors.push("DB: table A wrong org");
    }
    if (row.id === tenantB.tableId && row.organizationId !== tenantB.organizationId) {
      errors.push("DB: table B wrong org");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    proof: {
      tenantA: {
        organizationId: tenantA.organizationId,
        tableCount: listA.length,
        tableIds: listA.map((t) => t.id),
        ownTable: tenantA.tableId,
        ownGetName: fullA.name,
      },
      tenantB: {
        organizationId: tenantB.organizationId,
        tableCount: listB.length,
        tableIds: listB.map((t) => t.id),
        ownTable: tenantB.tableId,
        ownGetName: fullB.name,
      },
      crossGetBlocked: true,
    },
  };
}

async function main() {
  const seed = await seedTwoTenants();
  console.log("Seeded two tenants:");
  console.log(
    JSON.stringify(
      {
        tenantA: {
          email: seed.tenantA.email,
          org: seed.tenantA.slug,
          organizationId: seed.tenantA.organizationId,
          tableId: seed.tenantA.tableId,
        },
        tenantB: {
          email: seed.tenantB.email,
          org: seed.tenantB.slug,
          organizationId: seed.tenantB.organizationId,
          tableId: seed.tenantB.tableId,
        },
      },
      null,
      2
    )
  );

  const result = await verifyTenantIsolation(seed);
  console.log("\nIsolation verify:", result.ok ? "PASS" : "FAIL");
  console.log(JSON.stringify(result.proof, null, 2));
  if (!result.ok) {
    console.error("Errors:", result.errors);
    await client.end();
    process.exit(1);
  }
  await client.end();
}

const isMain =
  import.meta.url === pathToFileURL(process.argv[1]!).href ||
  process.argv[1]?.endsWith("seed-tenants.ts");
if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    await client.end();
    process.exit(1);
  });
}
