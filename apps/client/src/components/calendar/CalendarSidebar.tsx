import type { Calendar } from "@tabdo/shared";
import { useTranslation } from "react-i18next";
import { NiCalendar, NiMoreHorizontal, NiPlus } from "@/components/icons";
import { SIDEBAR_ICON, SIDEBAR_ROW } from "@/components/shell/sidebar-styles";
import { cn } from "@/lib/utils";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from "@tabdo/ui/components/dropdown-menu";

type Props = {
  calendars: Calendar[]; calendarId: string; canManage: boolean; disabled: boolean;
  onFocusReturn(element: HTMLElement): void;
  onSelect(calendar: Calendar): void; onCreate(): void;
  onEdit(calendar: Calendar): void; onArchive(calendar: Calendar): void;
};
export function CalendarSidebar(props: Props) {
  const { t } = useTranslation("calendar");
  return <div className="flex flex-col gap-1 p-3">
    <div className="flex items-center justify-between gap-2 px-2.5"><h2 className="py-1 text-[10px] font-medium text-muted-foreground">{t("calendarList")}</h2>{props.canManage && <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" disabled={props.disabled} aria-label={t("newCalendar")} onClick={props.onCreate}><NiPlus /></Button>}</div>
    <nav aria-label={t("calendarList")} className="flex flex-col gap-0.5">
      {props.calendars.map(calendar => <div key={calendar.id} className={cn("group relative min-w-0 rounded-md", calendar.id === props.calendarId ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
        <button type="button" className={cn(SIDEBAR_ROW, "w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", props.canManage && "pr-9", calendar.id === props.calendarId && "font-medium")} aria-current={calendar.id === props.calendarId ? "true" : undefined} disabled={props.disabled} onClick={() => props.onSelect(calendar)}><NiCalendar className={SIDEBAR_ICON} /><span className="truncate">{calendar.name}</span></button>
        {props.canManage && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100" disabled={props.disabled} onFocus={event => props.onFocusReturn(event.currentTarget)} aria-label={t("calendarMore", { name: calendar.name })}><NiMoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuGroup><DropdownMenuLabel>{calendar.name}</DropdownMenuLabel><DropdownMenuItem onSelect={() => props.onEdit(calendar)}>{t("editCalendar")}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={() => props.onArchive(calendar)}>{t("archiveCalendar")}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
      </div>)}
      {!props.calendars.length && <p className="py-2 text-xs text-muted-foreground">{t("noCalendars")}</p>}
    </nav>
  </div>;
}
