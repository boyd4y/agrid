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

export function SitePreviewContent({ siteId, refreshToken, onHeaderChange }: PreviewSlotContext) {
  const { t } = useTranslation("sites");
  const [site, setSite] = useState<SiteDetail | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (siteId) void api.getSite(siteId).then(site => { if (active) setSite(site); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [siteId, refreshToken]);
  useEffect(() => {
    if (site?.kind === "blog") return;
    onHeaderChange?.({ title: site?.name, actions: site && <Button asChild variant="ghost" size="icon"><Link to={`/app/sites/${site.id}`} aria-label={t("openEditor")} title={t("openEditor")}><ExternalLink /></Link></Button> });
    return () => onHeaderChange?.(null);
  }, [site, onHeaderChange, t]);
  if (site?.kind === "blog") return <BlogEditor viewId={site.viewId!} onPreviewHeaderChange={onHeaderChange} />;
  return <div className="flex h-full min-h-0 flex-col">{error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p> : site ? <SitePreview siteId={site.id} files={site.files} toolbar="hidden" refreshToken={refreshToken} /> : <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading")}</p>}</div>;
}
