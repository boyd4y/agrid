import { useTranslation } from "react-i18next";
import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@tabdo/ui/components/dropdown-menu";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { api } from "@/lib/api";
import type { AutomationRule } from "@tabdo/shared";

export function AutomationActions({ rule, onDeleted }: {
  rule: Pick<AutomationRule, "id" | "name"> & Partial<Pick<AutomationRule, "source">>;
  onDeleted: (id: string) => void;
}) {
  const { t } = useTranslation("automation");
  const scheduled = rule.source?.kind === "schedule";
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={t(scheduled ? "scheduled.actionsNamed" : "actionsNamed", { name: rule.name })} title={t("actionsAria")}>
            <MoreHorizontal data-icon="inline-start" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={() => { setMenuOpen(false); setDeleteOpen(true); }}><Trash2 />{t(scheduled ? "scheduled.delete" : "deleteRule")}</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t(scheduled ? "scheduled.deleteTitle" : "deleteRuleQ")}
        description={t(scheduled ? "scheduled.deleteDescription" : "deleteRuleDescShort", { name: rule.name })}
        onConfirm={async () => { await api.deleteAutomation(rule.id); onDeleted(rule.id); }}
      />
    </>
  );
}
