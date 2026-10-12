import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Copy, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type MemberOption } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MembersEmpty } from "@/components/illustrations";
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
  const [tab, setTab] = useState<"list" | "create">("list");
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
    setMsg(null);
    setApiKeyOnce(null);
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
      setTab("list");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const isEmpty = !loading && agents.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10" data-testid="agents-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">智能体</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            配置人设 + Harness + 模型。Harness 创建后不可更换。权限与{" "}
            <Link to="/app/members" className="underline underline-offset-2 hover:text-foreground">
              成员
            </Link>{" "}
            对齐，走同一命令层。
          </p>
        </div>
        <Button size="sm" onClick={() => setTab("create")}>
          <Plus className="h-3.5 w-3.5" />
          创建智能体
        </Button>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-muted p-0.5 w-fit">
        {(
          [
            ["list", "智能体列表", Bot],
            ["create", "新建配置", Plus],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
              tab === id
                ? "bg-background text-foreground shadow-[0_4px_12px_rgba(55,53,47,0.06)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

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
        <div className="mb-4 rounded-md border border-[#F1E3B7] bg-[#FFF9E8] px-3 py-2 text-sm dark:border-border dark:bg-muted">
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

      {tab === "list" && (
        <div className="rounded-xl border border-border bg-background shadow-[0_8px_24px_rgba(55,53,47,0.04)]">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <MembersEmpty className="mb-4 w-full max-w-sm" />
              <h2 className="text-base font-semibold tracking-tight">还没有智能体</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                创建时选择 Harness（如 Pi + OpenRouter）与模型；API Key 用于外部 MCP / Skill。
              </p>
              <Button size="sm" className="mt-6" onClick={() => setTab("create")}>
                <Plus className="h-3.5 w-3.5" />
                创建智能体
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {agents.map((m) => {
                const h = (m.agent?.persona?.defaultHarness ?? "pi") as HarnessId;
                const model = m.agent?.persona?.defaultModel ?? "openrouter/free";
                return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E8DEEE]">
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
      )}

      {tab === "create" && (
        <form
          onSubmit={createAgent}
          className="space-y-4 rounded-xl border border-border bg-background p-6 shadow-[0_8px_24px_rgba(55,53,47,0.04)]"
          data-testid="agent-create-form"
        >
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
                    : [
                        { id: "pi" as const, label: "Pi / OpenRouter" },
                        { id: "codex" as const, label: "Codex" },
                        { id: "claude" as const, label: "Claude" },
                      ]
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
          <Button type="submit" disabled={busy || !agentName.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            创建智能体
          </Button>
        </form>
      )}
    </div>
  );
}
