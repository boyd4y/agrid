import { FloatingAssistantFrame } from "./FloatingAssistantFrame";
import { FloatingThreadControls } from "./FloatingThreadControls";
import { ChatActivityContext, ChatRunStatus } from "./ChatRunStatus";
import { AgentTaskPopover } from "./AgentTaskPopover";
import { ChatRunsProvider, ChatRunsContext, isActiveRun, PersistentRunCancel } from "./ChatRuns";
import type { ChatActivity } from "@tabdo/shared";
import { toast } from "sonner";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { Link, useLocation } from "react-router-dom";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  useRemoteThreadListRuntime,
  useAuiState,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
} from "lucide-react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/elements/model-selector.aui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, type MemberOption } from "@/lib/api";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { HARNESS_LABELS, type HarnessId } from "@/lib/harness";
import { chatResourceKey } from "@/lib/chat-resource";
import { ResourceScopedThreads } from "@/components/chat/ResourceScopedThreads";
import { SessionSwitcher } from "@/components/chat/SessionSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  createThreadAdapter,
  type ChatPageContext,
} from "@/lib/chat-persistence";
import { prepareNativeChatRequest } from "@/lib/native-chat-transport";

export type { HarnessId } from "@/lib/harness";

export type OpenPreviewPayload = {
  kind?: string;
  tableId?: string | null;
  viewId?: string | null;
  open?: boolean;
};

type Props = {
  tableId: string | null;
  onMutated: (tableId?: string | null) => void;
  /** home = split chat pane; drawer = right AI drawer */
  variant?: "drawer" | "home";
  /** Open/close the right UI Slot plugin panel (tool-driven). */
  onOpenPreview?: (payload: OpenPreviewPayload) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  /**
   * Override session pool key. Default: `table:{tableId}` or `workspace`.
   * Example: `automations` for a future dedicated page.
   */
  resourceKey?: string | null;
  floatingOpen?: boolean;
  onFloatingOpenChange?: (open: boolean) => void;
};

type RequestBody = {
  agentId: string | null;
  context: ChatPageContext;
};

const AuiWelcome: FC = () => null;

const THREAD_COMPONENTS = {
  Welcome: AuiWelcome,
  RunStatus: ChatRunStatus,
  ComposerCancel: PersistentRunCancel,
} as const;

const MUTATING_TOOLS = new Set([
  "set_relation",
  "add_relation",
  "remove_relation",
  "create_table",
  "update_cell",
  "update_cells",
  "add_row",
  "delete_row",
  "add_column",
  "delete_column",
  "set_status",
  "move_card",
  "update_column",
  "reorder_columns",
  "create_form_view",
  "update_form_view",
  "set_form_fields",
  "add_form_field",
  "remove_form_field",
  "reorder_form_fields",
  "set_form_sections",
  "set_form_theme",
  "set_form_layout",
  "set_form_field_settings",
  "rename_view",
  "set_default_view",
  "update_board_view",
  "delete_view",
  "create_grid_view",
  "create_board_view",
  "create_automation",
  "update_automation",
  "delete_automation",
]);

function messageHasMutations(message: {
  parts?: Array<{ type: string; toolName?: string; state?: string }>;
}): boolean {
  return (
    message.parts?.some(
      (p) =>
        p.state === "output-available" &&
        MUTATING_TOOLS.has(
          p.type === "dynamic-tool"
            ? (p.toolName ?? "")
            : p.type.replace(/^tool-/, ""),
        ),
    ) ?? false
  );
}

function extractOpenPreview(message: {
  parts?: Array<Record<string, unknown>>;
}): OpenPreviewPayload | null {
  for (const p of message.parts ?? []) {
    if (p.state !== "output-available") continue;
    const type = String(p.type ?? "");
    const toolName =
      (typeof p.toolName === "string" && p.toolName) ||
      (type.startsWith("tool-") ? type.slice("tool-".length) : null);
    if (toolName !== "open_preview" && type !== "tool-open_preview") continue;
    const output = (p.output ?? p.result ?? {}) as OpenPreviewPayload;
    const input = (p.input ?? p.args ?? {}) as OpenPreviewPayload;
    return {
      open: output.open ?? input.open ?? true,
      kind: output.kind ?? input.kind ?? "table",
      tableId: (output.tableId ?? input.tableId) as string | null | undefined,
      viewId: (output.viewId ?? input.viewId) as string | null | undefined,
    };
  }
  return null;
}

function agentHarness(a: MemberOption): HarnessId {
  return (a.agent?.persona?.defaultHarness as HarnessId) || "pi";
}

function agentModel(a: MemberOption): string {
  return a.agent?.persona?.defaultModel || "openrouter/free";
}

export function ChatPanel(props: Props) {
  const { user, session } = useAuth();
  
  return (
    <ScopedChatPanel
      key={`${user?.id}:${session?.activeOrganizationId}`}
      {...props}
    />
  );
}

function ThreadAgentBinding({ onSelect }: { onSelect: (id: string) => void }) {
  const threadId = useAuiState((s) => s.threads.mainThreadId);
  const savedAgentId = useAuiState((s) => s.threadListItem.custom?.agentId);
  useEffect(() => {
    if (typeof savedAgentId === "string") onSelect(savedAgentId);
  }, [threadId, savedAgentId, onSelect]);
  return null;
}

function RunAwareThread(props: React.ComponentProps<typeof Thread>) {
  const { runs } = useContext(ChatRunsContext);
  const streaming = useAuiState((s) => s.thread.isRunning);
  return <Thread {...props} composerDisabled={!streaming && isActiveRun(runs[0])} />;
}

function ScopedChatPanel({
  tableId,
  onMutated,
  floatingOpen = false,
  onFloatingOpenChange,
  variant = "drawer",
  onOpenPreview,
  previewOpen = false,
  onTogglePreview,
  resourceKey: resourceKeyProp,
}: Props) {
  const { t, i18n } = useTranslation("chat");
  const welcomeSuggestions = useMemo(
    () =>
      Suggestions(
        (["createTable", "createForm", "organize", "automation"] as const).map((key) => ({
          title: t(`suggestions.${key}.title`),
          label: t(`suggestions.${key}.label`),
          prompt: t(`suggestions.${key}.prompt`),
        })),
      ),
    [t, i18n.language],
  );
  const threadSidebarId = useId();
  const [threadListCollapsed, setThreadListCollapsed] = useState(() => {
    try {
      return localStorage.getItem("tabdo.chat.threadListCollapsed") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (variant !== "home") return;
    try {
      localStorage.setItem(
        "tabdo.chat.threadListCollapsed",
        String(threadListCollapsed),
      );
    } catch {
      // Collapsing still works when browser storage is unavailable.
    }
  }, [variant, threadListCollapsed]);
  const [agents, setAgents] = useState<MemberOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentId, setAgentId] = useState<string | null>(null);
  const selectSavedAgent = useCallback(
    (id: string) => {
      if (agents.some((agent) => agent.id === id)) setAgentId(id);
    },
    [agents],
  );
  const { pathname } = useLocation();
  const page: ChatPageContext["page"] =
    variant === "home"
      ? "ai"
      : /^\/app\/skills(?:\/|$)/.test(pathname)
        ? "skills"
      : /^\/app\/reports(?:\/|$)/.test(pathname)
        ? "reports"
      : /^\/app\/automations(?:\/|$)/.test(pathname) || pathname.endsWith("/automations")
        ? "automations"
        : /^\/app\/tables\/[^/]+$/.test(pathname)
          ? "table"
          : pathname.endsWith("/tables")
            ? "tables"
            : /^\/app\/agents(?:\/|$)/.test(pathname)
              ? "agents"
              : pathname.endsWith("/members")
                ? "members"
                : pathname.endsWith("/settings")
                  ? "settings"
                  : "ai";
  const boundTableId =
    page === "table" || page === "automations" ? tableId : null;

  const reportId = page === "reports" ? pathname.match(/^\/app\/reports\/([0-9a-f-]{36})$/)?.[1] ?? null : null;
  const resourceKey = useMemo(
    () =>
      chatResourceKey({
        tableId: boundTableId,
        resourceKey:
          resourceKeyProp ?? (reportId ? `report:${reportId}` : !boundTableId && page !== "ai" ? page : null),
      }),
    [boundTableId, resourceKeyProp, page, reportId],
  );

  const requestRef = useRef<RequestBody>({
    agentId: null,
    context: { page, tableId: boundTableId, reportId },
  });
  requestRef.current = { agentId, context: { page, tableId: boundTableId, reportId } };
  const threadAdapter = useMemo(
    () => createThreadAdapter(() => requestRef.current),
    [],
  );

  const onMutatedRef = useRef(onMutated);
  onMutatedRef.current = onMutated;
  const onOpenPreviewRef = useRef(onOpenPreview);
  onOpenPreviewRef.current = onOpenPreview;

  useEffect(() => {
    let cancelled = false;
    let version = 0;
    const load = () => {
      const requestVersion = ++version;
      return api
        .listMembers()
        .then((r) => {
          if (cancelled || requestVersion !== version) return;
          const list = (r.members ?? []).filter((m) => m.kind === "agent");
          setAgents(list);
          setAgentId((prev) => {
            if (prev && list.some((a) => a.id === prev)) return prev;
            return list[0]?.id ?? null;
          });
        })
        .catch(() => {
          if (!cancelled && requestVersion === version) setAgents([]);
        })
        .finally(() => {
          if (!cancelled && requestVersion === version) setAgentsLoading(false);
        });
    };
    void load();
    const onAgentsChanged = () => {
      void load();
    };
    window.addEventListener("tabdo:agents-changed", onAgentsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("tabdo:agents-changed", onAgentsChanged);
    };
  }, []);

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: prepareNativeChatRequest,
        body: () => ({
          agentId: requestRef.current.agentId,
          context: requestRef.current.context,
        }),
      }),
    [],
  );

  const streamMutated = useRef(false);
  const [activities, setActivities] = useState<Map<string, ChatActivity>>(new Map());
  const runtime = useRemoteThreadListRuntime({
    adapter: threadAdapter,
    runtimeHook: () =>
      useChatRuntime({
        transport,
        onError: (error) => {
          streamMutated.current = false;
          toast.error(error.message || t("agentRunFailed"));
        },
        onData: (part) => {
          if (part.type === "data-chat-activity") {
            const activity = part.data as ChatActivity;
            setActivities((previous) => {
              const next = new Map(previous);
              next.delete(activity.threadId);
              next.set(activity.threadId, activity);
              if (next.size > 30) next.delete(next.keys().next().value!);
              return next;
            });
          }
          if (part.type === "data-table-mutated") {
            const ids = (part as { data?: { tableIds?: string[] } }).data
              ?.tableIds;
            if (ids?.length) for (const id of ids) onMutatedRef.current(id);
            else onMutatedRef.current();
            streamMutated.current = true;
          }
          if (part.type === "data-open-preview") {
            const data = (part as { data?: OpenPreviewPayload }).data;
            onOpenPreviewRef.current?.(data ?? { open: true, kind: "table" });
          }
        },
        onFinish: ({ message }) => {
          if (!streamMutated.current && messageHasMutations(message)) {
            onMutatedRef.current();
          }
          streamMutated.current = false;
          const preview = extractOpenPreview(message);
          if (preview) {
            onOpenPreviewRef.current?.(preview);
          }
        },
      }),
  });

  const auiConfig = useMemo(
    () => AuiConfig({ suggestions: welcomeSuggestions }),
    [welcomeSuggestions],
  );

  const agentOptions: ModelOption[] = useMemo(
    () =>
      agents.map((a) => {
        const h = agentHarness(a);
        const m = agentModel(a);
        return {
          id: a.id,
          name: a.name,
          description: `${(HARNESS_LABELS[h] ?? h).split(" ")[0]} · ${m === "__harness_default__" ? t("defaultModel") : m.replace(/^openrouter\//, "")}`,
          keywords: [h, m, a.email],
          icon: (
            <MemberAvatar name={a.name} image={a.image} kind="agent" className="size-5" />
          ),
        };
      }),
    [agents, t],
  );

  const [showFloatingThreads, setShowFloatingThreads] = useState(false);
  const isHome = variant === "home";
  const noAgents = !agentsLoading && agents.length === 0;
  const selectAgent = async (next: string) => {
    if (next === agentId) return;
    if (runtime.thread.getState().isRunning) { toast.info(t("stopBeforeSwitch"));return; }
    try {
      const remoteId = runtime.threads.mainItem.getState().remoteId;
      if (remoteId && isActiveRun((await api.listAgentRuns(remoteId)).runs[0])) { toast.info(t("stopBeforeSwitch")); return; }
      if (runtime.thread.getState().messages.length) await runtime.threads.switchToNewThread();
      requestRef.current = { ...requestRef.current, agentId: next };
      setAgentId(next);
    } catch (error) { toast.error(error instanceof Error ? error.message : t("switchAgentFailed")); }
  };

  return (
    <ChatActivityContext.Provider value={activities}>
    <AssistantRuntimeProvider runtime={runtime} config={auiConfig}>
      <ChatRunsProvider onRecovered={() => onMutatedRef.current()}>
      <ResourceScopedThreads resourceKey={resourceKey} />
      <ThreadAgentBinding onSelect={selectSavedAgent} />
      <FloatingAssistantFrame
        floating={!isHome}
        open={floatingOpen}
        onOpenChange={onFloatingOpenChange}
      >
        <div
          className={cn(
            "@container/chat flex h-full min-h-0 min-w-0 bg-background",
          )}
          data-testid="chat-panel"
          data-resource-key={resourceKey}
        >
          {isHome && !noAgents && (
            <aside
              id={threadSidebarId}
              className={cn(
                "hidden w-56 shrink-0 border-r border-border bg-muted/30",
                !threadListCollapsed && "@[640px]/chat:block",
              )}
              aria-label={t("threadList")}
              data-testid="chat-thread-sidebar"
            >
              <ThreadList resourceKey={resourceKey} />
            </aside>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {(!isHome || !noAgents || onTogglePreview) && (
              <div
                className={cn(
                  "flex shrink-0 items-center justify-between gap-2 border-b border-border",
                  isHome ? "min-h-11 px-3 py-1" : "min-h-11 px-2 py-1",
                )}
                data-testid="chat-toolbar"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  {isHome && !noAgents && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden size-8 shrink-0 @[640px]/chat:inline-flex"
                      onClick={() =>
                        setThreadListCollapsed((collapsed) => !collapsed)
                      }
                      aria-label={
                        threadListCollapsed ? t("expandThreads") : t("collapseThreads")
                      }
                      title={
                        threadListCollapsed ? t("expandThreads") : t("collapseThreads")
                      }
                      aria-expanded={!threadListCollapsed}
                      aria-controls={threadSidebarId}
                      data-testid="chat-thread-list-toggle"
                    >
                      {threadListCollapsed ? (
                        <PanelLeftOpen className="size-4" />
                      ) : (
                        <PanelLeftClose className="size-4" />
                      )}
                    </Button>
                  )}
                  {isHome && !noAgents && (
                    <SessionSwitcher
                      resourceKey={resourceKey}
                      className={cn(
                        "min-w-0",
                        isHome && !threadListCollapsed
                          ? "@[640px]/chat:hidden"
                          : "max-w-[55%] shrink",
                      )}
                    />
                  )}

                  {agentsLoading ? (
                    <span className="text-[12px] text-muted-foreground">
                      {t("loadingAgents")}
                    </span>
                  ) : noAgents ? (
                    <span className="text-[12px] text-muted-foreground">
                      {t("noAgentSelected")}
                    </span>
                  ) : agentId ? (
                    <ModelSelector
                      key={agentOptions.map((o) => o.id).join(",")}
                      models={agentOptions}
                      value={agentId}
                      onValueChange={(next) => void selectAgent(next)}
                      size="sm"
                      variant="ghost"
                      searchable={agentOptions.length > 4}
                      className={cn(
                        "h-8 min-w-0 justify-between border-0 px-1.5 text-[12px] shadow-none",
                        isHome
                          ? "w-[160px] shrink-0"
                          : "w-[180px] max-w-full shrink",
                      )}
                      contentClassName="w-[240px] min-w-[200px] max-w-[280px]"
                    />
                  ) : null}
                </div>
                {!noAgents && <AgentTaskPopover />}
                {!isHome && (
                  <FloatingThreadControls
                    showThreads={showFloatingThreads}
                    onShowThreads={setShowFloatingThreads}
                    onClose={() => onFloatingOpenChange?.(false)}
                  />
                )}
                {isHome && onTogglePreview && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={onTogglePreview}
                    aria-label={previewOpen ? t("collapsePreview") : t("expandPreview")}
                    title={previewOpen ? t("collapsePreview") : t("expandPreview")}
                    aria-expanded={previewOpen}
                    aria-controls="workspace-preview-panel"
                    data-testid="workspace-preview-toggle"
                  >
                    {previewOpen ? (
                      <PanelRightClose className="size-4" />
                    ) : (
                      <PanelRightOpen className="size-4" />
                    )}
                  </Button>
                )}
              </div>
            )}

            {noAgents ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <AppEmptyState
                  className="flex-1"
                  data-testid="chat-no-agents"
                  illustration={NOTIOLY.fastInternet}
                  title={t("noAgentsTitle")}
                  description={t("noAgentsDescription")}
                  action={
                    <Button asChild size="sm">
                      <Link to="/app/agents">
                        <Plus className="size-3.5" />
                        {t("goCreateAgent")}
                      </Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {!isHome && showFloatingThreads && (
                  <div
                    className="min-h-0 flex-1"
                    data-testid="floating-thread-list"
                    onClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest(
                          '[data-slot="aui_thread-list-item-trigger"], [data-slot="aui_thread-list-new"]',
                        )
                      )
                        setShowFloatingThreads(false);
                    }}
                  >
                    <ThreadList resourceKey={resourceKey} showNew={false} />
                  </div>
                )}
                <div
                  className={cn(
                    "min-h-0 min-w-0 flex-1",
                    !isHome && showFloatingThreads && "hidden",
                  )}
                >
                  <RunAwareThread
                    components={THREAD_COMPONENTS}
                    autoFocus={isHome}
                    dockComposer={!isHome}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </FloatingAssistantFrame>
      </ChatRunsProvider>
    </AssistantRuntimeProvider>
    </ChatActivityContext.Provider>
  );
}
