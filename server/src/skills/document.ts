import { parseDocument } from "yaml";
import { z } from "zod";
import type { SkillFile } from "@tabdo/shared";

export class SkillError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

const metadataSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "名称使用小写字母、数字和连字符"),
  description: z.string().trim().min(1).max(1024),
});

/** Parse standard SKILL.md frontmatter without evaluating YAML tags or aliases. */
export function parseSkillDocument(document: string) {
  if (document.length > 64_000) throw new SkillError("SKILL.md 不能超过 64,000 个字符");
  const match = document.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!match) throw new SkillError("SKILL.md 需要 YAML frontmatter、name、description 和正文");
  let metadata: unknown;
  try {
    const yaml = parseDocument(match[1], { uniqueKeys: true, customTags: [] });
    if (yaml.errors.length || yaml.warnings.length) throw new Error("Invalid frontmatter");
    metadata = yaml.toJS({ maxAliasCount: 0 });
  } catch { throw new SkillError("SKILL.md 的 YAML frontmatter 无效"); }
  const result = metadataSchema.safeParse(metadata);
  if (!result.success) throw new SkillError(result.error.issues[0].message);
  const content = match[2].trim();
  if (!content) throw new SkillError("技能正文不能为空");
  return { ...result.data, content };
}

export function validateSkillFiles(files: SkillFile[]) {
  if (files.length > 80) throw new SkillError("每个技能最多包含 80 个附件");
  const paths = new Set<string>(["SKILL.md"]);
  let bytes = 0;
  for (const file of files) {
    if (!file.path || file.path.length > 240 || /[\\\x00-\x1f]/.test(file.path) || file.path.startsWith("/") || /^[a-z]:/i.test(file.path) || file.path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new SkillError("文件路径必须是技能目录内的相对 POSIX 路径");
    }
    if (paths.has(file.path)) throw new SkillError("技能文件路径不能重复或覆盖 SKILL.md");
    if ([...paths].some((path) => path.startsWith(`${file.path}/`) || file.path.startsWith(`${path}/`))) throw new SkillError("技能文件不能与目录路径冲突");
    if (file.content.length > 128_000) throw new SkillError("单个技能文件不能超过 128,000 个字符");
    paths.add(file.path); bytes += Buffer.byteLength(file.content);
  }
  if (bytes > 1_000_000) throw new SkillError("技能附件总大小不能超过 1 MB");
  return files;
}
