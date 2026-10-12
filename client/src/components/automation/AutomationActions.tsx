import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import { api } from "@/lib/api";
import type { AutomationRule } from "@table/shared";

export function AutomationActions({ rule, onDeleted }: {
  rule: Pick<AutomationRule, "id" | "name">;
  onDeleted: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`${rule.name}自动化操作`} title="自动化操作">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-1">
          <button type="button" className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none" onClick={() => { setMenuOpen(false); setDeleteOpen(true); }}>
            <Trash2 className="h-3.5 w-3.5" />删除规则
          </button>
        </PopoverContent>
      </Popover>
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
