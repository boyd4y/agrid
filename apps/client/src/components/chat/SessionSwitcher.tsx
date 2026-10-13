import { useMemo, useState, type FC } from "react";
import { ChevronDown, MessageSquare, Plus } from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tabdo/ui/components/popover";
import { cn } from "@/lib/utils";
import {
  type ChatResourceKey,
  formatRelativeTime,
  readThreadResourceKey,
  resourceKeyLabel,
  setLastThreadId,
} from "@/lib/chat-resource";

type Props = {
  resourceKey: ChatResourceKey;
  className?: string;
};

export const SessionSwitcher: FC<Props> = ({ resourceKey, className }) => {
  const { t } = useTranslation(["chat", "common"]);
  const aui = useAui();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const hasMore = useAuiState((s) => s.threads.hasMore);
  const loadingMore = useAuiState((s) => s.threads.isLoadingMore);
  const newChat = t("newChat");

  const scoped = useMemo(() => {
    const list = threadItems.filter((t) => {
      return readThreadResourceKey(t) === resourceKey;
    });
    return [...list].sort((a, b) => {
      const ta = a.lastMessageAt?.getTime() ?? 0;
      const tb = b.lastMessageAt?.getTime() ?? 0;
      return tb - ta;
    });
  }, [threadItems, resourceKey]);

  const recent = scoped.filter((thread) => (thread.title || newChat).toLowerCase().includes(search.trim().toLowerCase()));
  const main = threadItems.find((t) => t.id === mainThreadId);
  const title =
    (main && readThreadResourceKey(main) === resourceKey
      ? main.title
      : recent[0]?.title) || newChat;

  const switchTo = (threadId: string) => {
    aui.threads.switchToThread(threadId);
    setLastThreadId(resourceKey, threadId);
    setOpen(false);
  };

  const createNew = () => {
    aui.threads.switchToNewThread();
    setOpen(false);
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", className)}>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 max-w-[11rem] shrink gap-1 px-1.5 text-[12px] font-normal"
            data-testid="chat-session-switcher"
            title={t("switchSession")}
            aria-label={t("switchSession")}
          >
            <MessageSquare className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[260px] p-1.5"
          data-testid="chat-session-menu"
        >
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {resourceKeyLabel(resourceKey)}
          </p>
          {scoped.length > 4 && <Input size="sm" type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("searchSessions")} placeholder={t("searchSessions")} className="mb-1" />}
          {recent.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
              {search ? t("noMatchingSessions") : t("noSessionsYet")}
            </p>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto">
              {recent.map((thread) => {
                const active = thread.id === mainThreadId;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-muted",
                        active && "bg-muted"
                      )}
                      data-testid="chat-session-item"
                      data-active={active ? "true" : "false"}
                      onClick={() => switchTo(thread.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {thread.title || newChat}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {formatRelativeTime(thread.lastMessageAt) || t("noMessagesYet")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore && <Button variant="ghost" size="sm" className="w-full" disabled={loadingMore} onClick={() => void aui.threads.loadMore()}>{loadingMore ? t("common:loading") : t("moreSessions")}</Button>}
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-muted"
              data-testid="chat-session-new-in-menu"
              onClick={createNew}
            >
              <Plus className="size-3.5" />
              {newChat}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        title={newChat}
        aria-label={newChat}
        data-testid="chat-session-new"
        onClick={() => {
          aui.threads.switchToNewThread();
        }}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
};
