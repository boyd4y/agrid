import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";

/** 成员 = humans only. Agents live at /app/agents. Same underlying member APIs. */
export function MembersPage() {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
    setInviteError(null);
    try {
      await api.inviteMember(email.trim(), "member");
      setMsg("邀请已发送。");
      setEmail("");
      setShowInvite(false);
      await refresh().catch(() => setMsg("邀请已发送，但成员列表刷新失败，请稍后刷新页面。"));
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  const openInvite = () => {
    setMsg(null);
    setInviteError(null);
    setShowInvite(true);
  };

  const isEmpty = !loading && members.length === 0;

  return (
    <Dialog open={showInvite} onOpenChange={(open) => {
      if (busy) return;
      setShowInvite(open);
      if (open) {
        setInviteError(null);
        setMsg(null);
      }
    }}>
    <AppPage data-testid="members-page" header={
      <AppPageHeader page="members" description={<>
            邀请同事加入工作区。智能体请到{" "}
            <Link to="/app/agents" className="underline underline-offset-2 hover:text-foreground">
              智能体
            </Link>
            页面管理。
      </>}>
        <DialogTrigger asChild>
          <Button data-testid="members-invite-open">
            <UserPlus className="h-4 w-4" />
            邀请员工
          </Button>
        </DialogTrigger>
      </AppPageHeader>
    }>

      {msg && (
        <div role="status" className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {msg}
        </div>
      )}

      <DialogContent
        className="max-w-md"
        aria-describedby="member-invite-description"
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>邀请员工</DialogTitle>
          <p id="member-invite-description" className="text-sm text-muted-foreground">
            通过邮箱邀请同事加入当前工作区。
          </p>
        </DialogHeader>
        <form
          onSubmit={inviteHuman}
          className="space-y-4"
          data-testid="members-invite-form"
        >
          {inviteError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{inviteError}</p>}
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setShowInvite(false)}>取消</Button>
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "发送中…" : "发送邀请"}
            </Button>
          </div>
        </form>
      </DialogContent>

      <div className={isEmpty ? "flex min-h-0 flex-1 flex-col" : "rounded-xl border border-border bg-background shadow-[0_8px_24px_rgba(55,53,47,0.04)]"}>
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : isEmpty ? (
          <AppEmptyState
            data-testid="members-empty"
            className="flex-1"
            illustration={NOTIOLY.collaborate}
            title="还没有员工"
            description="邀请同事加入工作区，一起管理表格和自动化。"
            action={<Button size="sm" onClick={openInvite}>
              <UserPlus className="h-3.5 w-3.5" />
              邀请员工
            </Button>}
          />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
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
    </AppPage>
    </Dialog>
  );
}
