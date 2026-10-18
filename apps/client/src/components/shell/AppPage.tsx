import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { APP_NAVIGATION, type AppPageKey } from "./app-navigation";

/** Workspace pages fill the available pane, regardless of their content. */
export function AppPage({ className, header, contentWidth = "full", children, ...props }: HTMLAttributes<HTMLDivElement> & { header?: ReactNode; contentWidth?: "full" | "standard" }) {
  if (header) return (
    <div className="group/app-page flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden" data-content-width={contentWidth} {...props}>
      {header}
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-6 py-6 md:px-10", contentWidth === "full" && className)}>
        {contentWidth === "standard" ? <div data-slot="app-page-content" className={cn("mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col", className)}>{children}</div> : children}
      </div>
    </div>
  );
  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0 w-full flex-1 overflow-auto px-6 py-6 md:px-10",
        contentWidth === "standard" && "mx-auto max-w-5xl",
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
    <header className={cn("shrink-0 border-b border-border bg-background px-6 py-6 md:px-10", className)}>
      <div data-slot="app-page-header-content" className="flex w-full flex-wrap items-center justify-between gap-3 group-data-[content-width=standard]/app-page:mx-auto group-data-[content-width=standard]/app-page:max-w-5xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Icon className="h-5 w-5 shrink-0 text-muted-foreground" />{title ?? t(labelKey)}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}
