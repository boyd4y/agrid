import { CronExpressionParser } from "cron-parser";

export function schedulePreview(cron: string, timeZone: string, now: Date, count = 3): string[] {
  if (cron.trim().split(/\s+/).length !== 5 || cron.includes("H")) throw new Error("时间计划需要标准的五段 cron 表达式");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(now); }
  catch { throw new Error("请选择有效的 IANA 时区"); }
  const interval = CronExpressionParser.parse(cron, { tz: timeZone, currentDate: now });
  return interval.take(count).map(date => date.toDate().toISOString());
}
