import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { TableMeta } from "@/types/table";

export function TableActions({ table }: { table: Pick<TableMeta, "id" | "name"> }) {
  const { deleteTable } = useOutletContext<AppOutletContext>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`${table.name}表格操作`} title="表格操作">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-1">
          <button
            type="button"
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
            onClick={() => { setMenuOpen(false); setDeleteOpen(true); }}
          >
            <Trash2 className="h-3.5 w-3.5" />删除表格
          </button>
        </PopoverContent>
      </Popover>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除表格？"
        description={`将永久删除「${table.name}」及其所有数据、视图、自动化规则和运行记录。此操作无法撤销。`}
        onConfirm={() => deleteTable(table.id)}
      />
    </>
  );
}
