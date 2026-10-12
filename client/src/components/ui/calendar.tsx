import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("rdp-notion p-2 bg-popover text-popover-foreground", className)}
      style={
        {
          "--rdp-accent-color": "var(--foreground)",
          "--rdp-accent-background-color": "var(--muted)",
          "--rdp-selected-border": "2px solid transparent",
          "--rdp-today-color": "var(--foreground)",
          "--rdp-day-height": "32px",
          "--rdp-day-width": "32px",
          "--rdp-day_button-height": "32px",
          "--rdp-day_button-width": "32px",
          "--rdp-day_button-border-radius": "6px",
          "--rdp-background-color": "var(--popover)",
        } as React.CSSProperties
      }
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-2",
        month_caption: "flex justify-center pt-1 relative items-center h-8",
        caption_label: "text-sm font-medium text-foreground",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "absolute left-1 h-7 w-7 z-10 text-foreground"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "absolute right-1 h-7 w-7 z-10 text-foreground"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-8 font-normal text-[0.75rem]",
        week: "flex w-full mt-1",
        day: "rdp-day relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "rdp-day_button h-8 w-8 p-0 font-normal text-foreground hover:bg-accent aria-selected:opacity-100"
        ),
        selected:
          "rdp-selected rounded-md [&_.rdp-day_button]:bg-foreground [&_.rdp-day_button]:text-background [&_.rdp-day_button]:hover:bg-foreground [&_.rdp-day_button]:hover:text-background",
        today: "rdp-today rounded-md [&:not(.rdp-selected)]:bg-muted",
        outside: "rdp-outside text-muted-foreground opacity-50",
        disabled: "rdp-disabled text-muted-foreground opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
