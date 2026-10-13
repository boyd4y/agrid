import { Table2 } from "lucide-react";
import type { ReportData } from "@tabdo/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ReportDataPopover({ data, title }: { data: ReportData; title: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-2 w-fit shrink-0" data-testid="report-summary-trigger"
          aria-label={`查看汇总数据：${title}`} onClick={(event) => event.stopPropagation()}>
          <Table2 data-icon="inline-start" />查看汇总数据
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px]" side="top" align="start" aria-label={`${title}的汇总数据`}
        data-testid="report-summary-popover" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <h3 className="font-medium">{title} · 汇总数据</h3>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{data.sourceName}，{data.metricLabel}，共 {data.totalRows} 条记录</caption>
              <thead className="sticky top-0 bg-popover">
                <tr>
                  <th scope="col" className="p-2">分组</th>
                  <th scope="col" className="p-2 text-right">{data.metricLabel}</th>
                  <th scope="col" className="p-2 text-right">记录数</th>
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
          {data.truncated && <p className="text-xs text-muted-foreground">分组超过 200 个，仅显示前 200 个。</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
