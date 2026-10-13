import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { APP_NAVIGATION, type AppPageKey } from "./app-navigation";

/** Workspace pages fill the available pane, regardless of their content. */
export function AppPage({ className, header, children, ...props }: HTMLAttributes<HTMLDivElement> & { header?: ReactNode }) {
  if (header) return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden" {...props}>
      {header}
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-6 py-6 md:px-10", className)}>{children}</div>
    </div>
  );
  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0 w-full flex-1 overflow-auto px-6 py-10 md:px-10",
        className
      )}
      {...props}
    >{children}</div>
  );
}

export function AppPageHeader({ page, title, description, children, className }: {
  page: AppPageKey;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation("app");
  const { labelKey, icon: Icon } = APP_NAVIGATION[page];
  return (
    <header className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-6 md:px-10", className)}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Icon className="h-5 w-5 shrink-0 text-muted-foreground" />{title ?? t(labelKey)}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
