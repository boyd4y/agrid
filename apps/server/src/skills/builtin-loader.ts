import { readFileSync, readdirSync } from "node:fs";
import type { SkillDocument, SkillFile } from "@tabdo/shared";
import { parseSkillDocument, validateSkillFiles } from "./document.js";

const builtinRoot = new URL("../../skills/", import.meta.url);
function readBundle(root: URL, prefix = ""): SkillFile[] {
  return readdirSync(new URL(prefix, root), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return readBundle(root, `${relative}/`);
    if (!entry.isFile() || relative === "SKILL.md") return [];
    return [{ path: relative, content: readFileSync(new URL(relative, root), "utf8") }];
  });
}
export function loadBuiltinSkillDocuments(): SkillDocument[] {
  return readdirSync(builtinRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
  .map((entry) => {
    const document = readFileSync(new URL(`${entry.name}/SKILL.md`, builtinRoot), "utf8");
    const files = validateSkillFiles(readBundle(new URL(`${entry.name}/`, builtinRoot)));
    return { id: `builtin:${entry.name}`, document, ...parseSkillDocument(document), files, builtin: true, enabled: true, version: 1 };
  });

}
