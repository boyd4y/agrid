import { and, eq, inArray } from "drizzle-orm";
import { sha256 } from "@tabdo/core/crypto";
import { EMPTY_DOCUMENT, rowBodyWriteSchema, type RowBody, type RowBodyWrite, type DocumentContent } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Database, Transaction } from "../db/types.js";
import { recordDocumentLinks, recordDocuments, documentImages, documentReceipts } from "../db/schema.js";
import { DocumentError } from "../documents/errors.js";
import { documentImageIds, renderDocumentHtml } from "../documents/renderer.js";

export async function readRowBody(db: Database, tableId: string, rowId: string, format?: "json" | "html"): Promise<RowBody> {
  const [hit] = await db.select({ doc: recordDocuments }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId))
    .where(and(eq(recordDocumentLinks.rowId, rowId), eq(recordDocumentLinks.tableId, tableId)));
  const doc = hit?.doc, content = doc?.content ?? EMPTY_DOCUMENT;
  const attachments = doc ? await db.select({ fileId: documentImages.id, name: documentImages.name, mimeType: documentImages.mimeType, size: documentImages.size }).from(documentImages).where(eq(documentImages.documentId, doc.id)) : [];
  return { content, version: doc?.version ?? 0, schemaVersion: 1, attachments, ...(format === "html" ? { html: renderDocumentHtml(content) } : {}) };
}

/** Caller holds the owning row lock and has already authorized its table operation. */
export async function writeRowBody(deps: CommandDependencies, tx: Transaction, owner: { id: string; tableId: string; workspaceId: string; organizationId: string }, raw: RowBodyWrite): Promise<number> {
  const input = rowBodyWriteSchema.parse(raw), content = input.content as DocumentContent;
  const [hit] = await tx.select({ doc: recordDocuments }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId))
    .where(and(eq(recordDocumentLinks.rowId, owner.id), eq(recordDocumentLinks.tableId, owner.tableId)));
  const doc = hit?.doc;
  if ((doc?.version ?? 0) !== input.expectedVersion) throw new DocumentError(409, "VERSION_CONFLICT", "Body changed; retain your draft and reload");
  const ids = documentImageIds(content);
  const images = doc && ids.length ? await tx.select({ id: documentImages.id }).from(documentImages).where(and(eq(documentImages.documentId, doc.id), inArray(documentImages.id, ids))) : [];
  if (images.length !== ids.length) throw new DocumentError(400, "BAD_INPUT", "Image does not belong to this row");
  if (doc) {
    await tx.update(recordDocuments).set({ content, version: doc.version + 1, updatedAt: deps.now() }).where(eq(recordDocuments.id, doc.id));
    return doc.version + 1;
  }
  const [created] = await tx.insert(recordDocuments).values({ sourceRowId: owner.id, sourceTableId: owner.tableId, workspaceId: owner.workspaceId, organizationId: owner.organizationId, content, updatedAt: deps.now() }).returning();
  await tx.insert(recordDocumentLinks).values({ documentId: created.id, rowId: owner.id, tableId: owner.tableId, workspaceId: owner.workspaceId, organizationId: owner.organizationId });
  return 1;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function withRowReceipt<T>(tx: Transaction, scope: { workspaceId: string; principalId: string }, command: string, input: { idempotencyKey?: string }, work: () => Promise<T>): Promise<T> {
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey || input.idempotencyKey.length > 200) throw new DocumentError(400, "BAD_INPUT", "Body writes require an idempotencyKey (1–200 characters)");
  const requestHash = await sha256(canonical(input));
  const where = and(eq(documentReceipts.workspaceId, scope.workspaceId), eq(documentReceipts.principalId, scope.principalId), eq(documentReceipts.command, command), eq(documentReceipts.key, input.idempotencyKey));
  const [reserved] = await tx.insert(documentReceipts).values({ ...scope, command, key: input.idempotencyKey, requestHash }).onConflictDoNothing().returning();
  if (!reserved) {
    const [saved] = await tx.select().from(documentReceipts).where(where);
    if (saved.requestHash !== requestHash) throw new DocumentError(409, "IDEMPOTENCY_MISMATCH", "Idempotency key was already used for different input");
    return saved.result as T;
  }
  const result = await work();
  await tx.update(documentReceipts).set({ result }).where(eq(documentReceipts.id, reserved.id));
  return result;
}

/** Batch projection used by GraphQL; it never reads full bodies for ordinary row lists. */
export async function readRowBodies(db: Database, owners: { tableId: string; rowId: string }[]): Promise<Map<string, RowBody>> {
  const ids = owners.map(owner => owner.rowId);
  const docs = ids.length ? await db.select({ doc: recordDocuments, rowId: recordDocumentLinks.rowId, tableId: recordDocumentLinks.tableId }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId)).where(inArray(recordDocumentLinks.rowId, ids)) : [];
  const docIds = docs.map(hit => hit.doc.id);
  const images = docIds.length ? await db.select().from(documentImages).where(inArray(documentImages.documentId, docIds)) : [];
  return new Map(owners.map(owner => {
    const hit = docs.find(hit => hit.rowId === owner.rowId && hit.tableId === owner.tableId);
    return [owner.rowId, { content: hit?.doc.content ?? EMPTY_DOCUMENT, version: hit?.doc.version ?? 0, schemaVersion: 1, attachments: hit ? images.filter(image => image.documentId === hit.doc.id).map(({ id: fileId, name, mimeType, size }) => ({ fileId, name, mimeType, size })) : [] }];
  }));
}
