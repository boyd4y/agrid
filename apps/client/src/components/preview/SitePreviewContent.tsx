import { BlogEditor } from "@/components/sites/BlogEditor";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SiteDetail } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { SitePreview } from "@/components/sites/SitePreview";
import { api } from "@/lib/api";
import type { PreviewSlotContext } from "./preview-slot";
export function SitePreviewContent({ siteId, refreshToken }: PreviewSlotContext) {
  const { t } = useTranslation("sites");
  const [site, setSite] = useState<SiteDetail | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; setError(""); if (siteId) void api.getSite(siteId).then(site => { if (active) setSite(site); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [siteId, refreshToken]);
  if (site?.kind === "blog") return <BlogEditor key={`${site.id}:${refreshToken}`} siteId={site.id} />;
  return <div className="flex h-full min-h-0 flex-col">{site && <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2"><span className="truncate text-sm font-medium">{site.name}</span><Button asChild variant="outline" size="sm"><Link to={`/app/sites/${site.id}`}><ExternalLink />{t("openEditor")}</Link></Button></div>}{error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p> : site ? <SitePreview siteId={site.id} files={site.files} /> : <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading")}</p>}</div>;
}
