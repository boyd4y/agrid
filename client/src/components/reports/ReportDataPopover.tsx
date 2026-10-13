import { Table2 } from "lucide-react";
import type { ReportData } from "@tabdo/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

export function ReportDataPopover({ data, title }: { data: ReportData; title: string }) {
  const { t } = useTranslation("reports");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-2 w-fit shrink-0" data-testid="report-summary-trigger"
          aria-label={t("viewSummaryNamed", { title })} onClick={(event) => event.stopPropagation()}>
          <Table2 data-icon="inline-start" />{t("viewSummaryData")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px]" side="top" align="start" aria-label={t("summaryOf", { title })}
        data-testid="report-summary-popover" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <h3 className="font-medium">{t("summaryTitle", { title })}</h3>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("summaryCaption", { source: data.sourceName, metric: data.metricLabel, total: data.totalRows })}</caption>
              <thead className="sticky top-0 bg-popover">
                <tr>
                  <th scope="col" className="p-2">{t("group")}</th>
                  <th scope="col" className="p-2 text-right">{data.metricLabel}</th>
                  <th scope="col" className="p-2 text-right">{t("recordCount")}</th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((point) => (
                  <tr key={point.key} className="border-b border-border">
                    <td className="max-w-64 break-words p-2">{point.label}</td>
                    <td className="p-2 text-right tabular-nums">{point.value == null ? "—" : point.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="p-2 text-right tabular-nums">{point.records}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated && <p className="text-xs text-muted-foreground">{t("groupTruncatedShort")}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
