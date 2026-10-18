import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import type { SiteSourceFile } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { api } from "@/lib/api";

export function SitePreview({ siteId, files, className, toolbar = "visible", refreshToken }: { siteId: string; files: SiteSourceFile[]; className?: string; toolbar?: "visible" | "hidden"; refreshToken?: number }) {
  const { t } = useTranslation("sites");
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const token = useRef<string | undefined>(undefined), generation = useRef(0);
  useEffect(() => { token.current = undefined; setUrl(""); }, [siteId]);
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    const timer = window.setTimeout(() => {
      setBusy(true); setError("");
      void api.previewSite(siteId, files, token.current, current, controller.signal).then(result => {
        if (!controller.signal.aborted) { token.current = result.token; setUrl(`${result.url}?v=${current}`); }
      }).catch(error => { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : t("previewFailed")); token.current = undefined; } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [siteId, files, retry, refreshToken, t]);
  return <div className={`relative flex min-h-0 flex-1 flex-col bg-muted/30 ${className ?? ""}`} data-testid="site-preview">
    {toolbar === "visible" && <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-2">{t("preview")}{busy && <Loader2 className="size-3 animate-spin" aria-label={t("updating")} />}</span>
      <Button variant="ghost" size="icon" className="size-7" aria-label={t("refreshPreview")} onClick={() => setRetry(value => value + 1)}><RefreshCw /></Button>
    </div>}
    {toolbar === "hidden" && busy && url && <p role="status" className="absolute left-2 top-2 flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" />{t("updating")}</p>}
    {error && <p role="alert" className="border-b border-border px-3 py-2 text-xs text-destructive">{error}</p>}
    {url ? <iframe key={url} src={url} title={t("previewTitle")} sandbox="allow-scripts allow-forms allow-downloads" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-background" />
      : <p role="status" className="m-auto p-6 text-sm text-muted-foreground">{error ? t("previewFailed") : t("preparingPreview")}</p>}
  </div>;
}
