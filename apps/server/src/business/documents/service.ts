import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { sha256 } from "@tabdo/core/crypto";
import { DOCUMENT_SCHEMAS, DOCUMENT_READ_COMMANDS, DOCUMENT_LIMITS, type DocumentCommand, type DocumentResults, type DocumentContent, type DocumentPermission } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { member, rows, tables, recordDocuments, recordDocumentLinks, documentRevisions, documentReceipts, documentImages } from "../db/schema.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { resolveSiteKey, type SitePrincipal } from "../data-api/keys.js";
import { DocumentError } from "./errors.js";
import { documentImageIds, renderDocumentHtml } from "./renderer.js";
export type DocumentCaller = { kind: "member"; organizationId: string; actorId: string } | { kind: "key"; secret: string };
function fail(status: number, code: ConstructorParameters<typeof DocumentError>[1], message: string): never { throw new DocumentError(status, code, message); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const imageMeta = (image: typeof documentImages.$inferSelect) => ({ fileId: image.id, name: image.name, mimeType: image.mimeType, size: image.size });
function imageSignature(bytes: Uint8Array, mime: string) {
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  return mime === "image/png" ? starts(137, 80, 78, 71, 13, 10, 26, 10) : mime === "image/jpeg" ? starts(255, 216, 255) : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.slice(0, 6))) : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
/** A same-connection savepoint protects callers that turn tool errors into normal results. */
export async function executeDocument<K extends DocumentCommand>(deps: CommandDependencies, caller: DocumentCaller, command: K, raw: unknown, transaction?: Transaction): Promise<DocumentResults[K]> {
  const parsed = DOCUMENT_SCHEMAS[command].safeParse(raw);
  if (!parsed.success) fail(400, "BAD_INPUT", parsed.error.issues[0]?.message ?? "Invalid document input");
  const input = parsed.data as Record<string, any>, read = DOCUMENT_READ_COMMANDS.includes(command);
  return inTransaction(deps, transaction, root => transaction ? root.transaction(run) : run(root)) as Promise<DocumentResults[K]>;
  async function run(tx: Transaction): Promise<unknown> {
    let principal: SitePrincipal | undefined, organizationId: string, principalId: string;
    if (caller.kind === "key") { principal = await resolveSiteKey(tx, caller.secret, true); organizationId = principal.organizationId; principalId = `key:${principal.id}`; }
    else {
      organizationId = caller.organizationId; principalId = `user:${caller.actorId}`;
      const [current] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, caller.actorId))).for("share");
      if (!current) fail(403, "FORBIDDEN", "Current membership is required");
    }
    const permission: keyof Omit<DocumentPermission, "tableId"> = command === "createDocument" ? "canCreate" : command === "replaceDocument" ? "canUpdate" : command === "uploadDocumentImage" ? "canUpload" : command === "restoreDocumentRevision" ? "canRestore" : ["listDocumentRevisions", "getDocumentRevision"].includes(command) ? "canReadHistory" : "canRead";
    if (principal) {
      const grant = principal.documentPermissions.get(input.tableId);
      if (!grant) fail(404, "NOT_FOUND", "Record document not found");
      if (!grant[permission] || command === "replaceDocument" && input.expectedVersion === 0 && !grant.canCreate || (command === "restoreDocumentRevision" || command === "renderDocument" && input.version !== undefined) && !grant.canReadHistory) fail(403, "FORBIDDEN", "This document operation is not granted");
    }
    const [table] = await tx.select().from(tables).where(and(eq(tables.id, input.tableId), eq(tables.organizationId, organizationId))).for("key share");
    if (!table) fail(404, "NOT_FOUND", "Record document not found");
    if (!principal && (await requireWorkspace(deps, organizationId, tx)).id !== table.workspaceId) fail(404, "NOT_FOUND", "Record document not found");
    // Serializes create/CAS/upload with row deletion, without ever changing row.version.
    const rowQuery = tx.select({ id: rows.id }).from(rows).where(and(eq(rows.id, input.rowId), eq(rows.tableId, table.id)));
    const [row] = await (read ? rowQuery.for("key share") : rowQuery.for("update"));
    if (!row) fail(404, "NOT_FOUND", "Record document not found");
    const [linked] = await tx.select({ document: recordDocuments }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId)).where(and(eq(recordDocumentLinks.rowId, row.id), eq(recordDocumentLinks.tableId, table.id), eq(recordDocumentLinks.workspaceId, table.workspaceId), eq(recordDocumentLinks.organizationId, organizationId)));
    let doc = linked?.document;
    const receipt = () => ({ id: doc!.id, tableId: table.id, rowId: row.id, version: doc!.version, schemaVersion: 1 as const });
    const current = (content = doc!.content, version = doc!.version, updatedAt = doc!.updatedAt) => ({ ...receipt(), content, version, updatedAt: updatedAt.toISOString() });
    let requestId: string | undefined;
    if (!read) {
      const hash = await sha256(canonical(input));
      const [reservation] = await tx.insert(documentReceipts).values({ workspaceId: table.workspaceId, principalId, command, key: input.idempotencyKey, requestHash: hash }).onConflictDoNothing().returning();
      if (!reservation) {
        const [saved] = await tx.select().from(documentReceipts).where(and(eq(documentReceipts.workspaceId, table.workspaceId), eq(documentReceipts.principalId, principalId), eq(documentReceipts.command, command), eq(documentReceipts.key, input.idempotencyKey)));
        if (saved.requestHash !== hash) fail(409, "IDEMPOTENCY_MISMATCH", "Idempotency key was already used for different input");
        return saved.result;
      }
      requestId = reservation.id;
    }
    if (command !== "createDocument" && command !== "getDocument" && !(command === "replaceDocument" && input.expectedVersion === 0) && !doc) fail(404, "NOT_FOUND", "Document is not enabled");
    const cas = () => { if (doc!.version !== input.expectedVersion) fail(409, "VERSION_CONFLICT", "Document changed; retain your draft and reload"); };
    const revision = async () => {
      const [found] = await tx.select().from(documentRevisions).where(and(eq(documentRevisions.documentId, doc!.id), eq(documentRevisions.version, input.version)));
      if (!found) fail(404, "NOT_FOUND", "Document revision not found"); return found;
    };
    const assets = async (content: DocumentContent) => {
      const ids = documentImageIds(content);
      if (!ids.length) return [];
      const images = await tx.select().from(documentImages).where(and(eq(documentImages.documentId, doc!.id), inArray(documentImages.id, ids)));
      if (images.length !== ids.length) fail(400, "BAD_INPUT", "Image does not belong to this document");
      return images.map(imageMeta);
    };
    let result: unknown;
    switch (command) {
      case "getDocument": result = doc ? current() : null; break;
      case "createDocument": case "replaceDocument": {
        if (command === "replaceDocument" && input.expectedVersion !== 0) {
          cas(); await assets(input.content);
          [doc] = await tx.update(recordDocuments).set({ content: input.content, version: doc!.version + 1, updatedAt: deps.now() }).where(eq(recordDocuments.id, doc!.id)).returning();
          await tx.insert(documentRevisions).values({ documentId: doc.id, version: doc.version, content: doc.content, createdAt: deps.now() });
          result = receipt(); break;
        }
        if (doc) fail(409, command === "createDocument" ? "ALREADY_EXISTS" : "VERSION_CONFLICT", "Document already exists; retain your draft");
        if (documentImageIds(input.content).length) fail(400, "BAD_INPUT", "Create the document before uploading images");
        [doc] = await tx.insert(recordDocuments).values({ workspaceId: table.workspaceId, organizationId, sourceTableId: table.id, sourceRowId: row.id, content: input.content, updatedAt: deps.now() }).returning();
        await tx.insert(recordDocumentLinks).values({ documentId: doc.id, rowId: row.id, tableId: table.id, workspaceId: table.workspaceId, organizationId });
        await tx.insert(documentRevisions).values({ documentId: doc.id, version: 1, content: doc.content, createdAt: deps.now() });
        result = receipt(); break;
      }
      case "restoreDocumentRevision": {
        cas(); const content = (await revision()).content;
        await assets(content);
        [doc] = await tx.update(recordDocuments).set({ content, version: doc!.version + 1, updatedAt: deps.now() }).where(eq(recordDocuments.id, doc!.id)).returning();
        await tx.insert(documentRevisions).values({ documentId: doc.id, version: doc.version, content: doc.content, restoredFrom: command === "restoreDocumentRevision" ? input.version : null, createdAt: deps.now() });
        result = receipt(); break;
      }
      case "listDocumentRevisions": {
        const found = await tx.select({ version: documentRevisions.version, createdAt: documentRevisions.createdAt, restoredFrom: documentRevisions.restoredFrom }).from(documentRevisions).where(and(eq(documentRevisions.documentId, doc!.id), input.beforeVersion ? lt(documentRevisions.version, input.beforeVersion) : undefined)).orderBy(desc(documentRevisions.version)).limit(input.limit + 1);
        const items = found.slice(0, input.limit).map(v => ({ ...v, createdAt: v.createdAt.toISOString() }));
        result = { items, hasMore: found.length > input.limit, nextBeforeVersion: found.length > input.limit ? items.at(-1)!.version : null }; break;
      }
      case "getDocumentRevision": { const rev = await revision(); result = current(rev.content, rev.version, rev.createdAt); break; }
      case "renderDocument": { const content = input.version === undefined ? doc!.content : (await revision()).content; result = { html: renderDocumentHtml(content), assets: await assets(content), version: input.version ?? doc!.version, schemaVersion: 1 }; break; }
      case "uploadDocumentImage": {
        cas();
        if (!deps.sites || !deps.afterRollback) fail(503, "STORAGE_UNAVAILABLE", "Transactional document storage is unavailable");
        const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0));
        if (bytes.length > DOCUMENT_LIMITS.imageBytes || !imageSignature(bytes, input.mimeType)) fail(400, "BAD_INPUT", "Invalid image type or size");
        const all = await tx.select({ size: documentImages.size }).from(documentImages).where(eq(documentImages.documentId, doc!.id)).limit(DOCUMENT_LIMITS.attachments + 1);
        if (all.length >= DOCUMENT_LIMITS.attachments || all.reduce((sum, image) => sum + image.size, 0) + bytes.length > DOCUMENT_LIMITS.attachmentBytes) fail(400, "ATTACHMENT_LIMIT", "Document attachment budget exceeded");
        const id = deps.uuid(), driver = deps.sites.storageDriver as "local" | "s3", key = `${id.slice(0, 2)}/${id}`, storage = deps.sites.storage(driver);
        // Register before writing so nested and late outer failures both remove this owned blob.
        deps.afterRollback(tx, `document-image:${id}`, () => storage.remove(key));
        try { await storage.put(key, bytes, input.mimeType); } catch { fail(503, "STORAGE_UNAVAILABLE", "Image storage failed"); }
        const [image] = await tx.insert(documentImages).values({ id, documentId: doc!.id, name: input.name.replace(/[\u0000-\u001f\u007f]/g, ""), mimeType: input.mimeType, size: bytes.length, storageDriver: driver, storageKey: key }).returning();
        result = imageMeta(image); break;
      }
      case "getDocumentImage": {
        const [image] = await tx.select().from(documentImages).where(and(eq(documentImages.documentId, doc!.id), eq(documentImages.id, input.fileId)));
        if (!image) fail(404, "NOT_FOUND", "Document image not found");
        if (!deps.sites) fail(503, "STORAGE_UNAVAILABLE", "Image storage unavailable");
        try {
          const bytes = new Uint8Array(await new Response(await deps.sites.storage(image.storageDriver).open(image.storageKey)).arrayBuffer());
          let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          result = { ...imageMeta(image), base64: btoa(binary) };
        } catch { fail(503, "STORAGE_UNAVAILABLE", "Image storage unavailable"); }
        break;
      }
    }
    if (requestId) await tx.update(documentReceipts).set({ result }).where(eq(documentReceipts.id, requestId));
    return result;
  }
}
export function memberDocumentCommand<K extends DocumentCommand>(deps: CommandDependencies, command: K, input: Record<string, unknown> & { organizationId?: string; actorId?: string }, tx?: Transaction) {
  const { organizationId, actorId, ...raw } = input;
  if (!organizationId || !actorId) fail(403, "FORBIDDEN", "Current membership is required");
  return executeDocument(deps, { kind: "member", organizationId, actorId }, command, raw, tx);
}
