import { z } from "zod";
import { documentContentSchema, DOCUMENT_SCHEMAS, type DocumentContent, type DocumentImage } from "./documents.js";
export type RowBody = { content: DocumentContent; version: number; schemaVersion: 1; attachments: DocumentImage[]; html?: string };
export const rowBodyCreateSchema = z.strictObject({ content: documentContentSchema });
export const rowBodyWriteSchema = rowBodyCreateSchema.extend({ expectedVersion: z.number().int().nonnegative() });
export type RowBodyCreate = { content: DocumentContent };
export type RowBodyWrite = RowBodyCreate & { expectedVersion: number };
export const ROW_ATTACHMENT_SCHEMAS = {
  uploadRowAttachment: DOCUMENT_SCHEMAS.uploadDocumentImage.omit({ expectedVersion: true }).extend({ target: z.literal("body"), expectedVersion: z.number().int().nonnegative() }),
  getRowAttachment: DOCUMENT_SCHEMAS.getDocumentImage.extend({ target: z.literal("body") }),
};
export type RowAttachmentCommands = { [K in keyof typeof ROW_ATTACHMENT_SCHEMAS]: z.input<typeof ROW_ATTACHMENT_SCHEMAS[K]> };
export type RowAttachmentResults = { uploadRowAttachment: DocumentImage & { bodyVersion: number }; getRowAttachment: DocumentImage & { base64: string } };
