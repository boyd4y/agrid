import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { SkillDocument } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { SkillExplorer } from "@/components/skills/SkillExplorer";
import { Button } from "@tabdo/ui/components/button";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";

export function SkillDetailPage() {
  const { t } = useTranslation("common");
  const { skillId } = useParams();
  const [skill, setSkill] = useState<SkillDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setSkill(null); setError(null);
    api.getSkill(skillId!).then((next) => { if (active) setSkill(next); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [skillId]);
  return <AppPage className="gap-4" header={<AppPageHeader page="skills" description={skill?.name ?? t("skillDetail")}><Button asChild variant="outline" size="sm"><Link to="/app/skills"><ArrowLeft data-icon="inline-start" />{t("backToList")}</Link></Button></AppPageHeader>}>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !skill ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingSkill")}</p> : <>
      <p className="text-sm text-muted-foreground">{skill.description}</p><SkillExplorer key={skill.id} skill={skill} />
    </>}
  </AppPage>;
}
