import type { SkillDocument } from "@tabdo/shared";
import { parseSkillDocument, validateSkillFiles } from "@tabdo/backend/skills/document";
import bundle0file0 from "../../server/skills/automation/SKILL.md";
import bundle0file2 from "../../server/skills/automation/references/sources-and-bindings.md";
import bundle0file3 from "../../server/skills/automation/references/testing.md";
import bundle0file4 from "../../server/skills/automation/references/workflows.md";
import bundle1file0 from "../../server/skills/form/SKILL.md";
import bundle1file2 from "../../server/skills/form/references/checklist.md";
import bundle2file0 from "../../server/skills/report/SKILL.md";
import bundle2file2 from "../../server/skills/report/references/layout-and-charts.md";
import bundle2file3 from "../../server/skills/report/references/metrics.md";
import bundle2file5 from "../../server/skills/report/scripts/summarize-csv.py";
import bundle3file0 from "../../server/skills/table/SKILL.md";
import bundle3file2 from "../../server/skills/table/references/batch-workflows.md";
import bundle3file3 from "../../server/skills/table/references/cardinality.md";
import bundle3file4 from "../../server/skills/table/references/field-types.md";
import bundle3file5 from "../../server/skills/table/references/relations.md";

/** Canonical source bundles are imported as text by Wrangler, never read from a Worker filesystem. */
export function builtinSkills(): SkillDocument[] {
  return [
    { id: "builtin:automation", document: bundle0file0, files: [{ path: "references/sources-and-bindings.md", content: bundle0file2 }, { path: "references/testing.md", content: bundle0file3 }, { path: "references/workflows.md", content: bundle0file4 }] },
    { id: "builtin:form", document: bundle1file0, files: [{ path: "references/checklist.md", content: bundle1file2 }] },
    { id: "builtin:report", document: bundle2file0, files: [{ path: "references/layout-and-charts.md", content: bundle2file2 }, { path: "references/metrics.md", content: bundle2file3 }, { path: "scripts/summarize-csv.py", content: bundle2file5 }] },
    { id: "builtin:table", document: bundle3file0, files: [{ path: "references/batch-workflows.md", content: bundle3file2 }, { path: "references/cardinality.md", content: bundle3file3 }, { path: "references/field-types.md", content: bundle3file4 }, { path: "references/relations.md", content: bundle3file5 }] }
  ].map(bundle => ({ ...bundle, ...parseSkillDocument(bundle.document), files: validateSkillFiles(bundle.files), builtin: true, enabled: true, version: 1 }));
}
