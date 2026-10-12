import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, Loader2, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, type MemberOption } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MembersPanel({ open, onClose }: Props) {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"list" | "invite" | "agent">("list");
  const [email, setEmail] = useState("");
  const [agentName, setAgentName] = useState("");
  const [persona, setPersona] = useState("你是一名严谨的产品助理，用简洁中文操作表格。");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [apiKeyOnce, setApiKeyOnce] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMembers();
      setMembers(r.members);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const inviteHuman = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.inviteMember(email.trim(), "member");
      setMsg("邀请已发送（未配置 Resend 时链接会打在服务端日志）");
      setEmail("");
      setTab("list");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setApiKeyOnce(null);
    try {
      const r = await api.createAgent({
        name: agentName.trim(),
        role: "member",
        persona: { systemPrompt: persona, defaultHarness: "codex" },
      });
      setApiKeyOnce(r.apiKey);
      setAgentName("");
      setMsg("Agent 已创建（与人对等成员）。请立即复制 API Key，只显示一次。");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">成员</h2>
          <span className="text-xs text-muted-foreground">人 + Agent 同权</span>
          <button type="button" className="ml-auto rounded p-1 hover:bg-black/5" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(
            [
              ["list", "列表"],
              ["invite", "邀请同事"],
              ["agent", "创建 Agent"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium",
                tab === id
                  ? "bg-[var(--notion-fg)] text-white"
                  : "text-muted-foreground hover:bg-black/5"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {msg && (
            <p className="mb-3 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{msg}</p>
          )}
          {apiKeyOnce && (
            <div className="mb-3 rounded-md border border-border bg-background p-3">
              <p className="mb-1 text-xs font-medium">Agent API Key（仅此一次）</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1 text-[11px] ring-1 ring-border">
                  {apiKeyOnce}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(apiKeyOnce)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Header: <code>Authorization: Bearer agt_…</code> → POST /api/commands
              </p>
            </div>
          )}

          {tab === "list" && (
            <div>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  暂无成员列表（需登录并拥有工作区）。可邀请同事或创建 Agent。
                </p>
              ) : (
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white",
                          m.kind === "agent" ? "bg-violet-500" : "bg-[var(--notion-blue)]"
                        )}
                      >
                        {m.kind === "agent" ? <Bot className="h-4 w-4" /> : m.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.name}
                          <span className="ml-1.5 text-[10px] font-normal uppercase text-muted-foreground">
                            {m.kind}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email} · {m.role}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "invite" && (
            <form className="space-y-3" onSubmit={inviteHuman}>
              <p className="text-sm text-muted-foreground">
                通过 Resend 发送邀请邮件。未配置 <code>RESEND_API_KEY</code> 时，邀请链接打印在 API
                日志。
              </p>
              <div>
                <Label className="mb-1 block">邮箱</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                <UserPlus className="h-4 w-4" />
                {busy ? "发送中…" : "发送邀请"}
              </Button>
            </form>
          )}

          {tab === "agent" && (
            <form className="space-y-3" onSubmit={createAgent}>
              <p className="text-sm text-muted-foreground">
                Agent 是一套人设 + API Key，组织角色与人类相同，走同一套 commands。
              </p>
              <div>
                <Label className="mb-1 block">显示名</Label>
                <Input
                  required
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="产品助理 Bot"
                />
              </div>
              <div>
                <Label className="mb-1 block">人设 / System prompt</Label>
                <Textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                <Bot className="h-4 w-4" />
                {busy ? "创建中…" : "创建等权 Agent"}
              </Button>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
