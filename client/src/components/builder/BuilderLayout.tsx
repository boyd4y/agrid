import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Shared form/report editor: outline → canvas → selected-item inspector. */
export function BuilderLayout({
  sidebar,
  canvas,
  inspector,
  className,
  sidebarLabel,
  inspectorLabel,
}: {
  sidebar: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  className?: string;
  sidebarLabel?: string;
  inspectorLabel?: string;
}) {
  const { t } = useTranslation("common");
  const side = sidebarLabel ?? t("components");
  const insp = inspectorLabel ?? t("settings");
  return (
    <div
      className={cn(
        "grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_260px]",
        className,
      )}
      data-testid="builder-layout"
    >
      <aside aria-label={side} className="min-h-0 min-w-0 overflow-auto border-b border-border p-3 lg:border-b-0 lg:border-r">
        {sidebar}
      </aside>
      <div className="min-h-0 min-w-0 overflow-auto">{canvas}</div>
      <aside aria-label={insp} className="min-h-0 min-w-0 overflow-auto border-t border-border p-3 lg:border-l lg:border-t-0">
        {inspector}
      </aside>
    </div>
  );
}
