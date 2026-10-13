/** Skills are instruction documents; executable capabilities remain tools. */
export type SkillFile = { path: string; content: string };
export type SkillDocument = {
  id: string;
  name: string;
  description: string;
  document: string;
  content: string;
  files: SkillFile[];
  builtin: boolean;
  enabled: boolean;
  version: number;
};
export type SkillSummary = Omit<SkillDocument, "document" | "content" | "files"> & { fileCount: number };
export type SkillLibrary = { skills: SkillSummary[]; canManage: boolean };
