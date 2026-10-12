import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { Link } from "react-router-dom";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/ai-sdk";
import { Bot, Lock, Plus } from "lucide-react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/elements/model-selector.aui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, type MemberOption } from "@/lib/api";
import { HARNESS_LABELS, type HarnessId } from "@/lib/harness";
import { HarnessLogo } from "@/components/icons/HarnessLogos";
import { chatResourceKey } from "@/lib/chat-resource";
import { ResourceScopedThreads } from "@/components/chat/ResourceScopedThreads";
import { SessionSwitcher } from "@/components/chat/SessionSwitcher";

export type { HarnessId } from "@/lib/harness";

type HarnessStatus = {
  id: HarnessId;
  label: string;
  available: boolean;
  models: { id: string; label: string }[];
  defaultModel: string;
  provider?: string;
  hint?: string;
};

type ChatStatus = {
  mode: "live" | "mock";
  harnesses: HarnessStatus[];
};

export type OpenPreviewPayload = {
  kind?: string;
  tableId?: string | null;
  viewId?: string | null;
  open?: boolean;
};

type Props = {
  tableId: string | null;
  onMutated: () => void;
  /** home = split chat pane; drawer = right AI drawer */
  variant?: "drawer" | "home";
  /** Open/close the right UI Slot plugin panel (tool-driven). */
  onOpenPreview?: (payload: OpenPreviewPayload) => void;
  /**
   * Override session pool key. Default: `table:{tableId}` or `workspace`.
   * Example: `automations` for a future dedicated page.
   */
  resourceKey?: string | null;
};

type RequestBody = {
  agentId: string | null;
  tableId: string | null;
};

const WELCOME_SUGGESTIONS = Suggestions([
  {
    title: "建销售 CRM",
    label: "客户 · 阶段 · 负责人 · 下次跟进",
    prompt: "建一个销售 CRM：客户、阶段、负责人、下次跟进",
  },
  {
    title: "列出当前表",
    label: "预览前几行数据",
    prompt: "列出当前表的前几行",
  },
  {
    title: "加公式列",
    label: "工时 × 8",
    prompt: "加一列公式：工时×8",
  },
  {
    title: "算一下",
    label: "LaTeX 示例 $\\sum_{i=1}^{n} i$",
    prompt:
      "用 Markdown 和公式解释：行数 $n$ 时复杂度是 $O(n\\log n)$，并写出 $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$",
  },
]);

const AuiWelcome: FC = () => (
  <div className="aui-thread-welcome-root mb-4 flex flex-col px-1">
    <p className="text-xl font-medium tracking-tight text-foreground">
      用对话操作数据
    </p>
    <p className="mt-1 text-sm text-muted-foreground">
      选择智能体后建表、改单元格、加自动化。需要时智能体会打开右侧预览 Slot。
    </p>
  </div>
);

const THREAD_COMPONENTS = {
  Welcome: AuiWelcome,
} as const;

function messageHasToolParts(message: {
  parts?: Array<{ type: string }>;
}): boolean {
  return (
    message.parts?.some(
      (p) =>
        p.type === "dynamic-tool" ||
        p.type.startsWith("tool-") ||
        p.type === "tool-invocation"
    ) ?? false
  );
}

function extractOpenPreview(
  message: { parts?: Array<Record<string, unknown>> }
): OpenPreviewPayload | null {
  for (const p of message.parts ?? []) {
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

export function ChatPanel({
  tableId,
  onMutated,
  variant = "drawer",
  onOpenPreview,
  resourceKey: resourceKeyProp,
}: Props) {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [agents, setAgents] = useState<MemberOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentId, setAgentId] = useState<string | null>(null);

  const resourceKey = useMemo(
    () => chatResourceKey({ tableId, resourceKey: resourceKeyProp }),
    [tableId, resourceKeyProp]
  );

  const requestRef = useRef<RequestBody>({
    agentId: null,
    tableId,
  });
  requestRef.current = { agentId, tableId };

  const onMutatedRef = useRef(onMutated);
  onMutatedRef.current = onMutated;
  const onOpenPreviewRef = useRef(onOpenPreview);
  onOpenPreviewRef.current = onOpenPreview;

  useEffect(() => {
    fetch("/api/chat/status")
      .then((r) => r.json())
      .then((s: ChatStatus) => setStatus(s))
      .catch(() =>
        setStatus({
          mode: "mock",
          harnesses: [],
        })
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    api
      .listMembers()
      .then((r) => {
        if (cancelled) return;
        const list = (r.members ?? []).filter((m) => m.kind === "agent");
        setAgents(list);
        setAgentId((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        body: () => ({
          agentId: requestRef.current.agentId,
          tableId: requestRef.current.tableId,
        }),
      }),
    []
  );

  const runtime = useChatRuntime({
    transport,
    onData: (part) => {
      if (part.type === "data-table-mutated") {
        onMutatedRef.current();
      }
      if (part.type === "data-open-preview") {
        const data = (part as { data?: OpenPreviewPayload }).data;
        onOpenPreviewRef.current?.(data ?? { open: true, kind: "table" });
      }
    },
    onFinish: ({ message }) => {
      if (messageHasToolParts(message)) {
        onMutatedRef.current();
      }
      const preview = extractOpenPreview(message);
      if (preview) {
        onOpenPreviewRef.current?.(preview);
      }
    },
  });

  const auiConfig = useMemo(
    () => AuiConfig({ suggestions: WELCOME_SUGGESTIONS }),
    []
  );

  const selected = agents.find((a) => a.id === agentId) ?? null;
  const lockedHarness = selected ? agentHarness(selected) : null;
  const lockedModel = selected ? agentModel(selected) : null;
  const harnessStatus = status?.harnesses.find((h) => h.id === lockedHarness);
  const harnessOnline = harnessStatus?.available ?? false;

  const agentOptions: ModelOption[] = useMemo(
    () =>
      agents.map((a) => {
        const h = agentHarness(a);
        const m = agentModel(a);
        return {
          id: a.id,
          name: a.name,
          description: `${(HARNESS_LABELS[h] ?? h).split(" ")[0]} · ${m.replace(/^openrouter\//, "")}`,
          keywords: [h, m, a.email],
          icon: (
            <span className="flex size-5 items-center justify-center rounded-full bg-agent/10 text-agent">
              <Bot className="size-3" />
            </span>
          ),
        };
      }),
    [agents]
  );

  const isHome = variant === "home";
  const noAgents = !agentsLoading && agents.length === 0;

  return (
    <AssistantRuntimeProvider runtime={runtime} config={auiConfig}>
      <ResourceScopedThreads resourceKey={resourceKey} />
      <div
        className={cn(
          "flex h-full min-h-0 flex-col bg-background",
          !isHome && "border-l border-border"
        )}
        data-testid="chat-panel"
        data-resource-key={resourceKey}
      >
        {(!isHome || !noAgents) && <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-b border-border",
            isHome ? "h-11 px-6 md:px-10" : "h-11 px-2"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {!noAgents && (
              <SessionSwitcher resourceKey={resourceKey} className="min-w-0" />
            )}

            {agentsLoading ? (
              <span className="text-[12px] text-muted-foreground">加载智能体…</span>
            ) : noAgents ? (
              <span className="text-[12px] text-muted-foreground">未选择智能体</span>
            ) : agentId ? (
              <ModelSelector
                key={agentOptions.map((o) => o.id).join(",")}
                models={agentOptions}
                value={agentId}
                onValueChange={setAgentId}
                size="sm"
                variant="ghost"
                searchable={agentOptions.length > 4}
                className="h-8 w-[160px] shrink-0 justify-start border-0 px-1.5 text-[12px] shadow-none"
                contentClassName="w-[240px] min-w-[200px] max-w-[280px]"
              />
            ) : null}
          </div>

          {selected && lockedHarness ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title="Harness 创建时锁定，对话内不可更换"
              data-testid="chat-harness-badge"
            >
              <Lock className="size-2.5 opacity-70" />
              <HarnessLogo id={lockedHarness} className="size-3" />
              <span className="max-w-[7rem] truncate">
                {(HARNESS_LABELS[lockedHarness] ?? lockedHarness).split(" ")[0]}
                {lockedModel ? ` · ${lockedModel.replace(/^openrouter\//, "")}` : ""}
              </span>
              {!harnessOnline && (
                <span className="text-warning">off</span>
              )}
            </span>
          ) : (
            <span className="shrink-0" aria-hidden />
          )}
        </div>}

        {noAgents ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <AppEmptyState
              className="flex-1"
              data-testid="chat-no-agents"
              illustration={NOTIOLY.fastInternet}
              title="还没有智能体"
              description="创建一个智能体，开始对话、整理数据和配置自动化。"
              action={<Button asChild size="sm">
              <Link to="/app/agents">
                <Plus className="size-3.5" />
                去创建智能体
              </Link>
            </Button>}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 min-w-0 flex-1">
              <Thread components={THREAD_COMPONENTS} autoFocus={isHome} />
            </div>
          </div>
        )}
      </div>
    </AssistantRuntimeProvider>
  );
}
