import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type MemberOption } from "@/lib/api";
import { MembersEmpty } from "@/components/illustrations";

/** 成员 = humans only. Agents live at /app/agents. Same underlying member APIs. */
export function MembersPage() {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMembers();
      setMembers((r.members ?? []).filter((m) => m.kind !== "agent"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inviteHuman = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.inviteMember(email.trim(), "member");
      setMsg("邀请已发送（未配置 Resend 时链接会打在服务端日志）");
      setEmail("");
      setShowInvite(false);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  const openInvite = () => {
    setMsg(null);
    setShowInvite(true);
  };

  const isEmpty = !loading && members.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10" data-testid="members-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">成员</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            邀请员工加入工作区。智能体请到{" "}
            <Link to="/app/agents" className="underline underline-offset-2 hover:text-foreground">
              智能体
            </Link>
            ；底层与人对齐同一套权限。
          </p>
        </div>
        {!showInvite && (
          <Button size="sm" onClick={openInvite} data-testid="members-invite-open">
            <UserPlus className="h-3.5 w-3.5" />
            邀请员工
          </Button>
        )}
      </div>

      {msg && (
        <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {msg}
        </div>
      )}

      {showInvite && (
        <form
          onSubmit={inviteHuman}
          className="mb-4 space-y-4 rounded-xl border border-border bg-background p-6 shadow-[0_8px_24px_rgba(55,53,47,0.04)]"
          data-testid="members-invite-form"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">邀请员工</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                通过邮箱发送邀请。未配置 Resend 时链接会打在服务端日志。
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setShowInvite(false)}
              aria-label="关闭邀请"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            发送邀请
          </Button>
        </form>
      )}

      <div className="rounded-xl border border-border bg-background shadow-[0_8px_24px_rgba(55,53,47,0.04)]">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : isEmpty && !showInvite ? (
          <div className="flex flex-col items-center px-6 py-10 text-center" data-testid="members-empty">
            <MembersEmpty className="mb-4 w-full max-w-sm" />
            <h2 className="text-base font-semibold tracking-tight">还没有员工</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              用邮箱邀请同事。人和智能体共用命令层，但入口分开。
            </p>
            <Button size="sm" className="mt-6" onClick={openInvite}>
              <UserPlus className="h-3.5 w-3.5" />
              邀请员工
            </Button>
          </div>
        ) : isEmpty && showInvite ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            填写上方邮箱发送邀请后，员工会出现在这里。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#D3E5EF] text-xs font-semibold">
                  {(m.name || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.email} · {m.role} · 员工
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
