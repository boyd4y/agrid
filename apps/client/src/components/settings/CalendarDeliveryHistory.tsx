import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CALENDAR_DELIVERY_STATUSES, type CalendarSubscription, type CalendarDelivery, type CalendarSubscriptionPage, type CalendarResults, type CalendarDeliveryStatus } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { ListPagination } from "@/components/controls/list-pagination";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@tabdo/ui/components/sheet";
import { Field, FieldLabel, FieldError } from "@tabdo/ui/components/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@tabdo/ui/components/select";

export function CalendarDeliveryHistory({ subscription, open, onClose }: { subscription: CalendarSubscription; open: boolean; onClose(): void }) {
  const { t } = useTranslation("calendar");
  const [page, setPage] = useState<CalendarSubscriptionPage<CalendarDelivery>>(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [filter, setFilter] = useState<CalendarDeliveryStatus | "all">("all"), [revision, setRevision] = useState(0), [selected, setSelected] = useState("");
  const [details, setDetails] = useState<CalendarResults["getCalendarDelivery"]>(), [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false), [error, setError] = useState(""), [detailError, setDetailError] = useState("");
  const [retrying, setRetrying] = useState(false), [retryError, setRetryError] = useState("");
  const cursor = cursors.at(-1), calendarId = subscription.calendarId, subscriptionId = subscription.id;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void calendarCommand("listCalendarDeliveries", { calendarId, subscriptionId, cursor, ...(filter === "all" ? {} : { status: filter }) }, controller.signal).then(setPage).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [calendarId, subscriptionId, cursor, filter, revision]);
  useEffect(() => {
    const controller = new AbortController(); setDetails(undefined); setDetailError("");
    if (selected) {
      setDetailLoading(true);
      void calendarCommand("getCalendarDelivery", { calendarId, subscriptionId, deliveryId: selected }, controller.signal).then(setDetails).catch(cause => { if (!controller.signal.aborted) setDetailError(cause.message); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    }
    return () => controller.abort();
  }, [calendarId, subscriptionId, selected, revision]);
  return <Sheet open={open} onOpenChange={value => { if (!value && !retrying) onClose(); }}><SheetContent className="sm:w-[600px]">
    <SheetHeader><div className="flex items-center justify-between gap-3"><SheetTitle>{t("subscriptions.history")}</SheetTitle><Button variant="ghost" size="sm" disabled={retrying} onClick={onClose}>{t("close")}</Button></div><SheetDescription>{subscription.name} · {t("subscriptions.deliveryBoundary")}</SheetDescription></SheetHeader>
    <div className="flex min-w-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-end gap-2"><Field className="min-w-0 flex-1"><FieldLabel>{t("subscriptions.filterStatus")}</FieldLabel><Select value={filter} onValueChange={value => { setFilter(value as CalendarDeliveryStatus | "all"); setCursors([undefined]); }}><SelectTrigger aria-label={t("subscriptions.filterStatus")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t("subscriptions.allStatuses")}</SelectItem>{CALENDAR_DELIVERY_STATUSES.map(status => <SelectItem key={status} value={status}>{t(`subscriptions.deliveryStatus.${status}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Button variant="outline" disabled={loading || retrying} onClick={() => setRevision(v => v + 1)}>{t("refresh")}</Button></div>
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : error ? <ListErrorState description={error} onRetry={() => setRevision(v => v + 1)} /> : !page?.items.length ? <p className="py-5 text-sm text-muted-foreground">{t("subscriptions.noDeliveries")}</p> : <ul className="divide-y border-y">{page.items.map(delivery => <li key={delivery.id}><button type="button" className="flex w-full min-w-0 flex-col gap-2 rounded-sm px-1 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setSelected(delivery.id); setRetryError(""); }}><div className="flex flex-wrap items-center gap-2"><span className="text-sm">{t(`subscriptions.events.${delivery.event.type.replaceAll(".", "_")}`)}</span><Badge variant="secondary">{t(`subscriptions.deliveryStatus.${delivery.status}`)}</Badge></div><span className="break-all text-xs text-muted-foreground">{delivery.id}</span><span className="text-xs text-muted-foreground">{t("subscriptions.attemptCount", { count: delivery.attemptCount })} · {new Date(delivery.createdAt).toLocaleString()}</span></button></li>)}</ul>}
      {page && <ListPagination page={cursors.length} hasNext={page.hasMore} loading={loading} onPageChange={next => setCursors(current => next < current.length ? current.slice(0, -1) : [...current, page.nextCursor ?? undefined])} />}
      {selected && <section className="flex min-w-0 flex-col gap-3 border-t pt-4" aria-label={t("subscriptions.deliveryDetails")}>
        <h3 className="text-sm font-medium">{t("subscriptions.deliveryDetails")}</h3>
        {detailLoading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : detailError ? <ListErrorState description={detailError} onRetry={() => setRevision(v => v + 1)} /> : details && <>
          <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify({ ...details.delivery.event, deliveryId: details.delivery.id }, null, 2)}</pre>
          {details.delivery.lastError && <p className="text-sm text-muted-foreground">{t(`subscriptions.reasons.${details.delivery.lastError}`)}</p>}
          <ol className="divide-y border-y">{details.attempts.map(attempt => <li key={attempt.id} className="flex flex-col gap-1 py-2 text-sm"><span>{t("subscriptions.attempt", { number: attempt.attempt })} · {t(`subscriptions.attemptStatus.${attempt.status}`)}{attempt.httpStatus !== null && ` · HTTP ${attempt.httpStatus}`}</span><span className="text-xs text-muted-foreground">{new Date(attempt.startedAt).toLocaleString()}{attempt.finishedAt && ` → ${new Date(attempt.finishedAt).toLocaleString()}`}</span>{attempt.error && <span className="text-xs text-muted-foreground">{t(`subscriptions.reasons.${attempt.error}`)}</span>}</li>)}</ol>
          {!details.attempts.length && <p className="text-sm text-muted-foreground">{t("subscriptions.notAttempted")}</p>}
          {details.delivery.status === "deadletter" && subscription.status === "active" && details.delivery.subscriptionVersion === subscription.version && <Button disabled={retrying} onClick={() => {
            if (retrying) return; setRetrying(true); setRetryError("");
            void calendarCommand("retryCalendarDelivery", { calendarId, subscriptionId, deliveryId: selected, expectedVersion: subscription.version, idempotencyKey: crypto.randomUUID() }).then(() => setRevision(v => v + 1)).catch(cause => setRetryError(cause.message)).finally(() => setRetrying(false));
          }}>{t(retrying ? "subscriptions.retrying" : "subscriptions.retry")}</Button>}
          {retryError && <FieldError role="alert">{retryError}</FieldError>}
        </>}
      </section>}
    </div>
  </SheetContent></Sheet>;
}
