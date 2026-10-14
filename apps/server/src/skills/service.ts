import { and, eq, sql } from "drizzle-orm";
import type { SkillDocument, SkillFile } from "@tabdo/shared";
import type { HarnessV1Skill } from "@ai-sdk/harness";
import { loadBuiltinSkillDocuments } from "./builtin-loader.js";
import { getDatabase } from "@tabdo/platform/resources";

import { skills, skillSettings } from "../db/schema.js";
import { parseSkillDocument, validateSkillFiles, SkillError } from "./document.js";

const builtins = loadBuiltinSkillDocuments();

export async function listSkills(organizationId: string): Promise<SkillDocument[]> {
  const [custom, settings] = await Promise.all([
    getDatabase().select().from(skills).where(eq(skills.organizationId, organizationId)).orderBy(skills.name),
    getDatabase().select().from(skillSettings).where(eq(skillSettings.organizationId, organizationId)),
  ]);
  const overrides = new Map(settings.map((item) => [item.name, item.enabled]));
  return [...builtins.map((item) => ({ ...item, enabled: overrides.get(item.name) ?? true })), ...custom.map((item) => ({
    id: item.id, document: item.document, ...parseSkillDocument(item.document), files: item.files, builtin: false, enabled: item.enabled, version: item.version,
  }))];
}

export async function getSkill(organizationId: string, id: string) {
  const skill = (await listSkills(organizationId)).find((item) => item.id === id);
  if (!skill) throw new SkillError("技能不存在", 404);
  return skill;
}

export async function createSkill(organizationId: string, document: string, files: SkillFile[] = []) {
  const parsed = parseSkillDocument(document);
  validateSkillFiles(files);
  if (builtins.some((item) => item.name === parsed.name)) throw new SkillError("名称与内置技能重复，请更换名称", 409);
  const [created] = await getDatabase().insert(skills).values({ organizationId, name: parsed.name, description: parsed.description, document, files })
    .onConflictDoNothing().returning();
  if (!created) throw new SkillError("工作区中已有同名技能", 409);
  return { id: created.id, ...parsed, document, files: created.files, builtin: false, enabled: created.enabled, version: created.version };
}

export async function updateSkill(organizationId: string, id: string, document: string, expectedVersion: number, files?: SkillFile[]) {
  if (id.startsWith("builtin:")) throw new SkillError("内置技能内容只读，无法修改");
  const parsed = parseSkillDocument(document);
  if (files) validateSkillFiles(files);
  if (builtins.some((item) => item.name === parsed.name)) throw new SkillError("名称与内置技能重复", 409);
  const [current] = await getDatabase().select().from(skills).where(and(eq(skills.id, id), eq(skills.organizationId, organizationId)));
  if (!current) throw new SkillError("技能不存在", 404);
  let updated: typeof current | undefined;
  try {
    [updated] = await getDatabase().update(skills).set({ name: parsed.name, description: parsed.description, document, ...(files ? { files } : {}), version: sql`${skills.version} + 1`, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.organizationId, organizationId), eq(skills.version, expectedVersion))).returning();
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new SkillError("工作区中已有同名技能", 409);
    throw error;
  }
  if (!updated) throw new SkillError("技能已被其他操作更新，请重新加载后编辑", 409);
  return { id, ...parsed, document, files: updated.files, builtin: false, enabled: updated.enabled, version: updated.version };
}

export async function setSkillEnabled(organizationId: string, id: string, enabled: boolean) {
  const builtin = builtins.find((item) => item.id === id);
  if (builtin) {
    await getDatabase().insert(skillSettings).values({ organizationId, name: builtin.name, enabled })
      .onConflictDoUpdate({ target: [skillSettings.organizationId, skillSettings.name], set: { enabled } });
    return { ok: true };
  }
  if (id.startsWith("builtin:")) throw new SkillError("技能不存在", 404);
  const changed = await getDatabase().update(skills).set({ enabled, version: sql`${skills.version} + 1`, updatedAt: new Date() })
    .where(and(eq(skills.id, id), eq(skills.organizationId, organizationId))).returning({ id: skills.id });
  if (!changed.length) throw new SkillError("技能不存在", 404);
  return { ok: true };
}

export async function deleteSkill(organizationId: string, id: string) {
  if (id.startsWith("builtin:")) throw new SkillError("内置技能不能删除，可以关闭");
  const removed = await getDatabase().delete(skills).where(and(eq(skills.id, id), eq(skills.organizationId, organizationId))).returning({ id: skills.id });
  if (!removed.length) throw new SkillError("技能不存在", 404);
  return { ok: true };
}

/** Official HarnessAgent skills setting: full instructions are available on demand. */
export async function loadHarnessSkills(organizationId: string, selectedNames?: string[]): Promise<HarnessV1Skill[]> {
  return (await listSkills(organizationId)).filter((item) => item.enabled && (selectedNames === undefined || selectedNames.includes(item.name)))
    .map(({ name, description, content, files }) => ({ name, description, content, files }));
}

export async function validateSelectedSkills(organizationId: string, names: string[]) {
  const available = new Set((await listSkills(organizationId)).map((skill) => skill.name));
  if (new Set(names).size !== names.length || names.some((name) => !available.has(name))) throw new SkillError("选择的技能不存在或重复");
}
