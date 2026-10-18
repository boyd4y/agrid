import type { Calendar } from "@tabdo/shared";
import { useTranslation } from "react-i18next";
import { CalendarDays, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from "@tabdo/ui/components/dropdown-menu";
import { Separator } from "@tabdo/ui/components/separator";

type Props = {
  calendars: Calendar[]; calendarId: string; canManage: boolean; disabled: boolean;
  onFocusReturn(element: HTMLElement): void;
  onSelect(calendar: Calendar): void; onCreate(): void;
  onEdit(calendar: Calendar): void; onArchive(calendar: Calendar): void;
};
export function CalendarSidebar(props: Props) {
  const { t } = useTranslation("calendar");
  return <div className="flex flex-col gap-4 p-3">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium">{t("calendarList")}</h2>{props.canManage && <Button variant="ghost" size="icon" disabled={props.disabled} aria-label={t("newCalendar")} onClick={props.onCreate}><Plus /></Button>}</div>
    <nav aria-label={t("calendarList")} className="flex flex-col gap-1">
      {props.calendars.map(calendar => <div key={calendar.id} className="flex min-w-0 items-center gap-1">
        <Button variant={calendar.id === props.calendarId ? "secondary" : "ghost"} size="sm" className="min-w-0 flex-1 justify-start" aria-current={calendar.id === props.calendarId ? "true" : undefined} disabled={props.disabled} onClick={() => props.onSelect(calendar)}><CalendarDays data-icon="inline-start" /><span className="truncate">{calendar.name}</span></Button>
        {props.canManage && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={props.disabled} onFocus={event => props.onFocusReturn(event.currentTarget)} aria-label={t("calendarMore", { name: calendar.name })}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuLabel>{calendar.name}</DropdownMenuLabel><DropdownMenuGroup><DropdownMenuItem onSelect={() => props.onEdit(calendar)}>{t("editCalendar")}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={() => props.onArchive(calendar)}>{t("archiveCalendar")}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
      </div>)}
      {!props.calendars.length && <p className="py-2 text-xs text-muted-foreground">{t("noCalendars")}</p>}
    </nav>
    <Separator />
    <p className="text-xs leading-relaxed text-muted-foreground">{t("plans.legend")}</p>
  </div>;
}
