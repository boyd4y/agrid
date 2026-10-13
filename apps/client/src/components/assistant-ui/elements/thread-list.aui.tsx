"use client";

import { Button } from "@tabdo/ui/components/button";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Input } from "@tabdo/ui/components/input";
import { Skeleton } from "@tabdo/ui/components/skeleton";
import { cn } from "@/lib/utils";
import { readThreadResourceKey } from "@/lib/chat-resource";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  Loader2Icon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  forwardRef,
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

export const ThreadList: FC<{ resourceKey?: string; showNew?: boolean }> = ({
  resourceKey,
  showNew = true,
}) => {
  const { t } = useTranslation("chat");
  const [search, setSearch] = useState("");

  useEffect(() => setSearch(""), [resourceKey]);

  return (
    <ThreadListRoot className="h-full min-h-0 p-3">
      <div
        className="mb-2 flex items-center gap-1"
        data-testid="chat-thread-list-actions"
      >
        <ThreadListSearch value={search} onValueChange={setSearch} />
        {showNew && (
          <ThreadListNew
            size="icon"
            className="size-8 shrink-0 justify-center px-0"
            aria-label={t("newChat")}
            title={t("newChat")}
          >
            <PlusIcon className="size-4" />
          </ThreadListNew>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadListItems searchQuery={search} resourceKey={resourceKey} />
      </div>
      <ThreadListLoadMore />
    </ThreadListRoot>
  );
};

const ThreadListLoadMore: FC = () => {
  const { t } = useTranslation(["chat", "common"]);
  const aui = useAui();
  const hasMore = useAuiState((s) => s.threads.hasMore);
  const loading = useAuiState((s) => s.threads.isLoadingMore);
  if (!hasMore) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => void aui.threads.loadMore()}
    >
      {loading ? t("common:loading") : t("moreThreads")}
    </Button>
  );
};

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(({ className, value, onValueChange, ...props }, ref) => {
  const { t } = useTranslation("chat");
  return (
    <div
      data-slot="aui_thread-list-search"
      className="relative min-w-0 flex-1 px-0.5 py-1"
    >
      <SearchIcon
        data-slot="aui_thread-list-search-icon"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={t("searchThreads")}
        placeholder={t("searchThreads")}
        className={cn("h-8 ps-8 text-sm", className)}
        {...props}
      />
    </div>
  );
});

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot: FC<
  ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>
> = ({ className, ...props }) => {
  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className={cn("flex min-h-full flex-col gap-0.5", className)}
      {...props}
    />
  );
};

export const ThreadListItems: FC<
  ComponentPropsWithoutRef<"div"> & {
    searchQuery?: string;
    resourceKey?: string;
  }
> = ({ className, searchQuery = "", resourceKey, ...props }) => {
  return (
    <div
      data-slot="aui_thread-list-items"
      className={cn("flex min-h-full flex-col gap-0.5", className)}
      {...props}
    >
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups
          searchQuery={searchQuery}
          resourceKey={resourceKey}
        />
      </AuiIf>
    </div>
  );
};

const dateGroupLabel = (
  date: Date | undefined,
  startOfToday: number,
  startOfYesterday: number,
): string => {
  if (!date || date.getTime() >= startOfToday) return i18n.t("chat:today");
  if (date.getTime() >= startOfYesterday) return i18n.t("chat:yesterday");
  return i18n.t("chat:earlier");
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const subscribeToNextDay = (onDayChange: () => void) => {
  let timeout: number;
  const scheduleNextDay = () => {
    const now = new Date();
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    timeout = window.setTimeout(() => {
      onDayChange();
      scheduleNextDay();
    }, startOfTomorrow - now.getTime());
  };
  scheduleNextDay();
  return () => window.clearTimeout(timeout);
};

const getStartOfToday = () => startOfLocalDay(new Date());

// A server render and hydration see no day start, so a prerender never reads
// the clock; a client-only mount groups on its first render.
const getServerStartOfToday = () => undefined;

const useStartOfToday = () =>
  useSyncExternalStore<number | undefined>(
    subscribeToNextDay,
    getStartOfToday,
    getServerStartOfToday,
  );

export type ThreadListGroup = { label: string; indices: number[] };

/**
 * Filters the thread list by title and buckets the matches by last activity
 * (Today, Yesterday, Earlier). `groups` is null when no thread carries a date
 * or while the local day start is unknown during server render and hydration,
 * in which case `filteredIndices` keeps the runtime order.
 */
export const useThreadListGroups = (searchQuery = "", resourceKey?: string) => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const query = searchQuery.trim().toLowerCase();
  const startOfToday = useStartOfToday();

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
    const filteredIndices = threadIds
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => {
        const item = itemsById.get(id);
        if (!item || item.status !== "regular") return false;
        if (resourceKey && readThreadResourceKey(item) !== resourceKey)
          return false;
        return !query || (item.title || i18n.t("chat:newChat")).toLowerCase().includes(query);
      })
      .map(({ index }) => index);
    if (
      startOfToday === undefined ||
      !filteredIndices.some((index) => dates[index])
    ) {
      return { threadIds, filteredIndices, groups: null };
    }

    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfYesterday = yesterday.getTime();
    const time = (index: number) =>
      dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of sorted) {
      const label = dateGroupLabel(
        dates[index],
        startOfToday,
        startOfYesterday,
      );
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return { threadIds, filteredIndices, groups: result };
  }, [threadIds, threadItems, query, startOfToday, resourceKey]);
};

const ThreadListItemGroups: FC<{
  searchQuery?: string;
  resourceKey?: string;
}> = ({ searchQuery = "", resourceKey }) => {
  const { t } = useTranslation("chat");
  const { threadIds, filteredIndices, groups } = useThreadListGroups(
    searchQuery,
    resourceKey,
  );
  const query = searchQuery.trim();

  if (filteredIndices.length === 0) {
    return (
      <div
        data-slot="aui_thread-list-empty"
        data-testid="thread-list-empty"
        className="flex flex-1 flex-col items-center justify-center gap-3 px-3 py-8 text-center"
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {query ? (
            <SearchIcon className="size-5" />
          ) : (
            <MessageSquareIcon className="size-5" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {query ? t("noMatchingThreads") : t("noThreadsYet")}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {query ? t("tryOtherKeywords") : t("startWithAgent")}
          </p>
        </div>
        {!query && (
          <ThreadListNew variant="outline" className="justify-center" />
        )}
      </div>
    );
  }

  if (!groups) {
    return filteredIndices.map((index) => (
      <ThreadListPrimitive.ItemByIndex
        key={threadIds[index]}
        index={index}
        components={{ ThreadListItem }}
      />
    ));
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <div
        data-slot="aui_thread-list-group-label"
        className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium"
      >
        {group.label}
      </div>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex
          key={threadIds[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
    </Fragment>
  ));
};

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  const { t } = useTranslation("chat");
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        ref={ref}
        variant="ghost"
        data-slot="aui_thread-list-new"
        className={cn(
          "hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <PlusIcon
              data-slot="aui_thread-list-new-icon"
              className="size-4 shrink-0"
            />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn("whitespace-nowrap", labelClassName)}
            >
              {t("newChat")}
            </span>
          </>
        )}
      </Button>
    </ThreadListPrimitive.New>
  );
});

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => {
  const { t } = useTranslation("chat");
  return (
    <div role="status" aria-label={t("loadingThreads")} className="flex flex-col gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton
            data-slot="aui_thread-list-skeleton"
            className="h-3.5 w-full"
          />
        </div>
      ))}
    </div>
  );
};

export const ThreadListItem: FC = () => {
  const { t } = useTranslation("chat");
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);

  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className="group hover:bg-muted focus-visible:bg-muted data-active:bg-muted has-focus-visible:bg-muted has-data-[state=open]:bg-muted relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none"
    >
      <ThreadListItemPrimitive.Trigger
        data-slot="aui_thread-list-item-trigger"
        className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-data-[state=open]:pe-9 group-data-active:pe-9 focus-visible:ring-1"
      >
        {isRunning && (
          <Loader2Icon
            aria-hidden
            data-slot="aui_thread-list-item-running"
            className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin"
          />
        )}
        <span
          data-slot="aui_thread-list-item-title"
          className="min-w-0 flex-1 truncate"
        >
          <ThreadListItemPrimitive.Title fallback={t("newChat")} />
        </span>
        {isRunning && <span className="sr-only">Running</span>}
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMore />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC = () => {
  const { t } = useTranslation("chat");
  const aui = useAui();
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <ThreadListItemMorePrimitive.Root sharedFocusGroup>
        <ThreadListItemMorePrimitive.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-slot="aui_thread-list-item-more"
            className="data-[state=open]:bg-accent absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-3.5" />
            <span className="sr-only">{t("threadActions")}</span>
          </Button>
        </ThreadListItemMorePrimitive.Trigger>
        <ThreadListItemMorePrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          data-slot="aui_thread-list-item-more-content"
          className="popover-surface bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5"
        >
          <ThreadListItemMorePrimitive.Item
            onSelect={() => setDeleteOpen(true)}
            data-slot="aui_thread-list-item-more-item"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          >
            <TrashIcon className="size-4" />
            {t("delete")}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemMorePrimitive.Content>
      </ThreadListItemMorePrimitive.Root>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteThreadTitle")}
        description={t("deleteThreadDescription")}
        onConfirm={async () => {
          await aui.threadListItem.delete();
        }}
      />
    </>
  );
};
