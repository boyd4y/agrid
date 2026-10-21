import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tabdo/ui/components/button";
import { CardDescription, CardTitle } from "@tabdo/ui/components/card";
import { connectionValues } from "@/components/connections/connection-guide";

type Props = {
  publicMode?: boolean;
  canManageKeys?: boolean;
  secret?: string;
  onCreate?: (name: string) => void;
  createDisabled?: boolean;
  firstKey?: boolean;
};

export function AgentConnectionGuide({ publicMode = false, canManageKeys = true, secret, onCreate, createDisabled, firstKey }: Props) {
  const { t } = useTranslation("app");
  const text = (key: string) => t(`settings.connections.${key}`);
  const activeSecret = publicMode ? undefined : secret;
  const instructions = t("settings.connections.instructions", connectionValues(window.location.origin, { secret, publicMode }));
  async function copy() {
    try { await navigator.clipboard.writeText(instructions); toast.success(text("copied")); }
    catch { toast.error(text("copyFailed")); }
  }

  return <section className="flex min-w-0 flex-col gap-5" data-testid="agent-connection-guide">
    <header className="flex flex-col gap-2">
      <CardTitle>{publicMode ? text("guideTitle") : t("settings.tabs.connections")}</CardTitle>
      <CardDescription>{text("description")}</CardDescription>
    </header>
    {publicMode ? <div className="flex flex-col items-start gap-3 text-sm">
      <p className="max-w-prose leading-relaxed text-muted-foreground">{text("prepare")}</p>
      <Button asChild variant="outline" size="sm"><Link to="/app/settings?tab=connections">{text("openWorkspace")}</Link></Button>
    </div> : <div className="flex flex-wrap items-center gap-4">
      {canManageKeys && onCreate && <Button variant="outline" disabled={createDisabled} onClick={() => onCreate(text("keyName"))}>{text(activeSecret ? "createAnother" : "createConfiguration")}</Button>}
      <p className="text-sm text-muted-foreground" role={activeSecret ? "status" : undefined}>{text(activeSecret ? "generated" : firstKey ? "firstKey" : "useTemplate")}</p>
    </div>}
    <div className="flex min-w-0 flex-col gap-4 rounded-md border bg-muted/40 p-4" data-testid="connection-recipe">
      <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid="connection-text">{instructions}</p>
      <Button className="self-start" size="sm" onClick={() => void copy()}><Copy data-icon="inline-start" />{text("copyInstructions")}</Button>
    </div>
  </section>;
}
