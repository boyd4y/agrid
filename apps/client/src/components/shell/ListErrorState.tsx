import type { HTMLAttributes, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
};

/** Shared list/page failure chrome: short copy + one primary retry. */
export function ListErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
  ...props
}: Props) {
  const { t } = useTranslation(["errors", "common"]);
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[240px] w-full flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {title ?? t("errors:listLoadFailed")}
      </h2>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("errors:genericRetry")}
        </p>
      )}
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" />
          {retryLabel ?? t("common:reload")}
        </Button>
      )}
    </div>
  );
}
