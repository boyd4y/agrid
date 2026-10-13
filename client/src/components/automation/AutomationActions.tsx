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
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`${rule.name}自动化操作`} title="自动化操作">
            <MoreHorizontal data-icon="inline-start" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={() => { setMenuOpen(false); setDeleteOpen(true); }}><Trash2 />删除规则</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除自动化规则？"
        description={`将永久删除「${rule.name}」及其运行记录。表格数据会保留，此操作无法撤销。`}
        onConfirm={async () => { await api.deleteAutomation(rule.id); onDeleted(rule.id); }}
      />
    </>
  );
}
