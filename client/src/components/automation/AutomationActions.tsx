import { useTranslation } from "react-i18next";
import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import { api } from "@/lib/api";
import type { AutomationRule } from "@tabdo/shared";

export function AutomationActions({ rule, onDeleted }: {
  rule: Pick<AutomationRule, "id" | "name">;
  onDeleted: (id: string) => void;
}) {
  const { t } = useTranslation("automation");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={t("actionsNamed", { name: rule.name })} title={t("actionsAria")}>
            <MoreHorizontal data-icon="inline-start" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={() => { setMenuOpen(false); setDeleteOpen(true); }}><Trash2 />{t("deleteRule")}</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteRuleQ")}
        description={t("deleteRuleDescShort", { name: rule.name })}
        onConfirm={async () => { await api.deleteAutomation(rule.id); onDeleted(rule.id); }}
      />
    </>
  );
}
