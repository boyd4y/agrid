import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { cn } from "@/lib/utils";

export function ListPagination({ page, hasNext, onPageChange, totalPages, loading = false, compact = false, variant = "outline", className }: {
  page: number;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  totalPages?: number;
  loading?: boolean;
  compact?: boolean;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const { t } = useTranslation("common");
  return <nav aria-label={t("pagination.label")} className={cn("mt-5 flex flex-wrap items-center justify-end gap-2", className)}>
    <Button type="button" variant={variant} size={compact ? "icon" : "sm"} aria-label={t("pagination.previous")} disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft data-icon="inline-start" />{!compact && t("pagination.previous")}</Button>
    <p className="min-w-20 text-center text-sm text-muted-foreground" aria-live="polite" aria-atomic="true">{totalPages === undefined ? t("pagination.page", { page }) : t("pagination.pageOf", { page, total: totalPages })}</p>
    <Button type="button" variant={variant} size={compact ? "icon" : "sm"} aria-label={t("pagination.next")} disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)}>{!compact && t("pagination.next")}<ChevronRight data-icon="inline-end" /></Button>
  </nav>;
}
