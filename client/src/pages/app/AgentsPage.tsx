import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Copy, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { HARNESS_LABELS, type HarnessId } from "@/lib/harness";
import { HarnessLogo, OpenRouterLogo } from "@/components/icons/HarnessLogos";

type HarnessStatus = {
  id: HarnessId;
  label: string;
  available: boolean;
  models: { id: string; label: string }[];
  defaultModel: string;
  provider?: string;
  hint?: string;
};

type ProviderStatus = {
  id: string;
  label: string;
  available: boolean;
  defaultModel: string;
};

/** 智能体 = agents only. Same member/command APIs as humans; setup includes harness+model. */
export function AgentsPage() {
  const [agents, setAgents] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [persona, setPersona] = useState(
    "你是一名严谨的产品助理，用简洁中文操作表格。"
  );
  const [harness, setHarness] = useState<HarnessId>("pi");
  const [model, setModel] = useState("openrouter/free");
  const [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [apiKeyOnce, setApiKeyOnce] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMembers();
      setAgents((r.members ?? []).filter((m) => m.kind === "agent"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    fetch("/api/chat/status")
      .then((r) => r.json())
      .then((s: { harnesses?: HarnessStatus[]; providers?: ProviderStatus[] }) => {
        setProviders(s.providers ?? []);
        const list = s.harnesses ?? [];
        setHarnesses(list);
        const prefer =
          list.find((h) => h.id === "pi") ||
          list.find((h) => h.available) ||
          list[0];
        if (prefer) {
          setHarness(prefer.id);
          setModel(prefer.defaultModel);
        }
      })
      .catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const h = harnesses.find((x) => x.id === harness);
    if (h) setModel(h.defaultModel);
  }, [harness, harnesses]);

  const current = useMemo(
    () => harnesses.find((h) => h.id === harness),
    [harnesses, harness]
  );

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const r = await api.createAgent({
        name: agentName.trim(),
        role: "member",
        persona: {
          systemPrompt: persona,
          defaultHarness: harness,
          defaultModel: model,
        },
      });
      setApiKeyOnce(r.apiKey);
      setMsg("智能体已创建。请立刻复制 API Key，之后无法再看。");
      setAgentName("");
      setCreateOpen(false);
      await refresh().catch(() => setMsg("智能体已创建。请复制 API Key；列表刷新失败，请稍后刷新页面。"));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const isEmpty = !loading && agents.length === 0;

  return (
    <Dialog
      open={createOpen}
      onOpenChange={(open) => {
        if (busy) return;
        setCreateOpen(open);
        if (open) setCreateError(null);
      }}
    >
    <AppPage data-testid="agents-page" header={
      <AppPageHeader page="agents" description={<>
            配置人设 + Harness + 模型。Harness 创建后不可更换。权限与{" "}
            <Link to="/app/members" className="underline underline-offset-2 hover:text-foreground">
              成员
            </Link>{" "}
            对齐，走同一命令层。
      </>}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4" />
            创建智能体
          </Button>
        </DialogTrigger>
      </AppPageHeader>
    }>

      {providers.some((p) => p.id === "openrouter") && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <OpenRouterLogo className="size-3.5" />
          <span>
            OpenRouter 为独立 AI Provider
            {providers.find((p) => p.id === "openrouter")?.available
              ? " · 在线"
              : " · 离线"}
            ，Codex / Claude / Pi 均可复用（默认 openrouter/free）。
          </span>
        </div>
      )}

      {msg && (
        <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {msg}
        </div>
      )}

      {apiKeyOnce && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <div className="mb-1 font-medium">API Key（仅显示一次）</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs">{apiKeyOnce}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(apiKeyOnce)}
            >
              <Copy className="h-3.5 w-3.5" />
              复制
            </Button>
          </div>
        </div>
      )}

        <div className={isEmpty ? "flex min-h-0 flex-1 flex-col" : "rounded-xl border border-border bg-background shadow-[0_8px_24px_rgba(55,53,47,0.04)]"}>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : isEmpty ? (
            <AppEmptyState
              className="flex-1"
              illustration={NOTIOLY.fastInternet}
              title="还没有智能体"
              description="创建智能体，选择人设与模型，开始对话和处理数据。"
              action={
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  创建智能体
                </Button>
              </DialogTrigger>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {agents.map((m) => {
                const h = (m.agent?.persona?.defaultHarness ?? "pi") as HarnessId;
                const model = m.agent?.persona?.defaultModel ?? "openrouter/free";
                return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-agent/10 text-agent">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.role} · 智能体
                    </div>
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title="Harness 创建后锁定"
                  >
                    <Lock className="size-2.5 opacity-70" />
                    <HarnessLogo id={h} className="size-3" />
                    {(HARNESS_LABELS[h] ?? h).split(" ")[0]} · {model.replace(/^openrouter\//, "")}
                  </span>
                </li>
                );
              })}
            </ul>
          )}
        </div>

      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-xl p-0 sm:rounded-xl"
        aria-describedby="agent-create-description"
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle className="pr-8">创建智能体</DialogTitle>
          <p id="agent-create-description" className="text-sm text-muted-foreground">
            设置名称、人设、Harness 与模型。
          </p>
        </DialogHeader>
        <form
          onSubmit={createAgent}
          className="min-h-0 space-y-4 overflow-y-auto px-6 pb-6"
          data-testid="agent-create-form"
        >
          {createError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createError}
            </p>
          )}
          <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agentName">名称</Label>
            <Input
              id="agentName"
              required
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="产品助理 Agent"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona">人设</Label>
            <Textarea
              id="persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Harness</Label>
              <Select
                value={harness}
                onValueChange={(v) => setHarness(v as HarnessId)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 harness">
                    {current ? (
                      <span className="flex items-center gap-2">
                        <HarnessLogo id={current.id} className="size-3.5 opacity-80" />
                        {current.label}
                        {current.available === false ? " (offline)" : ""}
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(harnesses.length
                    ? harnesses
                    : ([
                        {
                          id: "pi",
                          label: "Pi / OpenRouter",
                          available: true,
                          models: [],
                          defaultModel: "openrouter/free",
                          provider: "openrouter",
                        },
                        {
                          id: "codex",
                          label: "Codex",
                          available: false,
                          models: [],
                          defaultModel: "gpt-5",
                        },
                        {
                          id: "claude",
                          label: "Claude",
                          available: false,
                          models: [],
                          defaultModel: "claude-sonnet-4",
                        },
                      ] satisfies HarnessStatus[])
                  ).map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      <span className="flex items-center gap-2">
                        <HarnessLogo id={h.id} className="size-3.5 opacity-80" />
                        <span>
                          {h.label}
                          {"available" in h && h.available === false ? " (offline)" : ""}
                          {h.provider === "openrouter" ? " · via OpenRouter" : ""}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                <Lock className="mr-0.5 inline size-2.5 align-[-1px]" />
                创建后 Harness 不可更换；模型可在新建时选定。
                {current?.hint ? ` ${current.hint}` : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>模型</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {(current?.models ?? [{ id: "openrouter/free", label: "OpenRouter Free" }]).map(
                    (m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !agentName.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "创建中…" : "创建智能体"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </AppPage>
    </Dialog>
  );
}
