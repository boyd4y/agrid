// Shared adapter for upstream heading/alignment/color dropdowns (84e08b1, MIT).
import { useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@tabdo/ui/components/dropdown-menu";
import { useToolbar } from "./toolbar-provider";
export function ToolbarMenu({ label, children, icon, active, disabled: unavailable }: { label: string; children: (run: (command: () => void) => void) => ReactNode; icon?: ReactNode; active?: boolean; disabled?: boolean }) {
  const { disabled } = useToolbar(), executed = useRef(false);
  return <DropdownMenu onOpenChange={open => { if (open) executed.current = false; }}><DropdownMenuTrigger asChild><Button type="button" size="sm" className="h-8" variant={active ? "secondary" : "ghost"} disabled={disabled || unavailable} aria-label={label}>{icon ?? label}<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" onCloseAutoFocus={event => { if (executed.current) event.preventDefault(); }}><DropdownMenuGroup>{children(command => { executed.current = true; command(); })}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
export { DropdownMenuItem as ToolbarMenuItem };
