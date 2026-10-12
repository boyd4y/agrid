import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq, isNull, like, inArray } from "drizzle-orm";
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

/** Fixed local demo credentials — also documented in README */
export const DEMO_EMAIL = "demo@agrid.app";
export const DEMO_PASSWORD = "Demo1234!";
export const DEMO_NAME = "Demo User";
export const DEMO_ORG_NAME = "Demo Workspace";
export const DEMO_ORG_SLUG = "demo-workspace";

/**
 * Idempotent: create Better Auth email/password user + org membership if missing.
 * Uses the same password hasher as Better Auth so sign-in works.
 */
export async function seedDemoUser(): Promise<{
  userId: string;
  organizationId: string;
  created: boolean;
}> {
  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, DEMO_EMAIL))
    .limit(1);

  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
    // Ensure credential account exists; refresh password so re-seed resets it
    const [cred] = await db
      .select()
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, "credential"))
      )
      .limit(1);
    const hashed = await hashPassword(DEMO_PASSWORD);
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
    const hashed = await hashPassword(DEMO_PASSWORD);
    await db.insert(user).values({
      id: userId,
      name: DEMO_NAME,
      email: DEMO_EMAIL,
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

  let [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, DEMO_ORG_SLUG))
    .limit(1);

  if (!org) {
    const orgId = randomUUID();
    [org] = await db
      .insert(organization)
      .values({
        id: orgId,
        name: DEMO_ORG_NAME,
        slug: DEMO_ORG_SLUG,
      })
      .returning();
  }

  const [mem] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, org.id))
    )
    .limit(1);

  if (!mem) {
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: org.id,
      userId,
      role: "owner",
    });
  }

  // Attach orphan seed tables to demo org
  await db
    .update(tables)
    .set({ organizationId: org.id })
    .where(isNull(tables.organizationId));

  // Remove empty UI placeholder tables (「新表格 N」 with 0 rows) — demo noise
  const placeholders = await db
    .select({ id: tables.id })
    .from(tables)
    .where(like(tables.name, "新表格%"));
  if (placeholders.length > 0) {
    const ids = placeholders.map((t) => t.id);
    await db.delete(rows).where(inArray(rows.tableId, ids));
    await db.delete(columns).where(inArray(columns.tableId, ids));
    await db.delete(tables).where(inArray(tables.id, ids));
  }

  return { userId, organizationId: org.id, created };
}

async function main() {
  const result = await seedDemoUser();
  console.log(
    result.created
      ? "Demo user created."
      : "Demo user already present (password refreshed)."
  );
  console.log("Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  userId:   ${result.userId}`);
  console.log(`  orgId:    ${result.organizationId}`);
  await client.end();
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    await client.end();
    process.exit(1);
  });
}
