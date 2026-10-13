import { useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { MoreHorizontal, Trash2, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableIconPicker } from "./TableIcon";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import { DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { TableMeta } from "@/types/table";

export function TableActions({ table, renderMenu, onMenuClose }: { table: Pick<TableMeta, "id" | "name" | "icon" | "pinned">; renderMenu?: (items: ReactNode) => ReactNode; onMenuClose?: () => void }) {
  const { deleteTable, updateTableMetadata } = useOutletContext<AppOutletContext>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const closeMenu = () => { setMenuOpen(false); onMenuClose?.(); };
  const pin = async () => {
    setBusy(true); setError(null);
    try { await updateTableMetadata(table.id, { pinned: !table.pinned }); closeMenu(); }
    catch (error) { setError(error instanceof Error ? error.message : "置顶失败"); }
    finally { setBusy(false); }
  };
  const remove = () => { closeMenu(); setDeleteOpen(true); };
  const items = <DropdownMenuGroup>
    <TableIconPicker expanded menuItem value={table.icon} onChange={(icon) => updateTableMetadata(table.id, { icon })} />
    <DropdownMenuItem disabled={busy} onSelect={(event) => { event.preventDefault(); void pin(); }}>{table.pinned ? <PinOff /> : <Pin />}{table.pinned ? "取消工作区置顶" : "置顶到工作区"}</DropdownMenuItem>
    {error && <p role="alert" className="p-2 text-xs text-destructive">{error}</p>}
    <DropdownMenuItem variant="destructive" onSelect={remove}><Trash2 />删除表格</DropdownMenuItem>
  </DropdownMenuGroup>;
  return (
    <>
      {renderMenu ? renderMenu(items) : <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`${table.name}表格操作`} title="表格操作">
            <MoreHorizontal data-icon="inline-start" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          <TableIconPicker expanded value={table.icon} onChange={(icon) => updateTableMetadata(table.id, { icon })} />
          <Button variant="ghost" size="sm" className="w-full justify-start px-2 text-sm font-normal" disabled={busy} onClick={() => void pin()}>{table.pinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}{table.pinned ? "取消工作区置顶" : "置顶到工作区"}</Button>
          <Separator className="my-1" />
          {error && <p role="alert" className="p-2 text-xs text-destructive">{error}</p>}
          <Button variant="destructive-ghost" size="sm"
            type="button"
            className="w-full justify-start"
            onClick={remove}
          >
            <Trash2 data-icon="inline-start" />删除表格
          </Button>
        </PopoverContent>
      </Popover>}
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
