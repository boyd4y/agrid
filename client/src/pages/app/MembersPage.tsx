import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Loader2, UserPlus, X, Send, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldGroup, FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MemberDirectory, MemberDirectoryRow } from "@/components/members/MemberDirectory";
import { AvatarPicker } from "@/components/members/AvatarPicker";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";

function MemberAvatarEditor({ member }: { member: MemberOption }) {
  const [open, setOpen] = useState(false), [image, setImage] = useState(member.image ?? null);
  const [busy, setBusy] = useState(false), [processing, setProcessing] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const save = async () => {
    if (submitting.current || processing || image === (member.image ?? null)) return;
    submitting.current = true; setBusy(true); setError(null);
    try { await api.updateMemberAvatar(member.id, image); toast.success("头像已保存"); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "头像保存失败"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Popover open={open} onOpenChange={(next) => { if (!busy && !processing) { if (next) { setImage(member.image ?? null); setError(null); } setOpen(next); } }}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" aria-label={`编辑 ${member.name}的头像`}><ImagePlus data-icon="inline-start" />头像</Button></PopoverTrigger>
    <PopoverContent className="w-96 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto" align="end" aria-label="编辑成员头像">
      <div className="flex flex-col gap-4">
        <AvatarPicker name={member.name} image={image} onChange={setImage} disabled={busy} onProcessingChange={setProcessing} />
        {error && <FieldError role="alert">{error}</FieldError>}
        <Separator />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy || processing} onClick={() => setOpen(false)}><X data-icon="inline-start" />取消</Button>
          <Button size="sm" disabled={busy || processing || image === (member.image ?? null)} onClick={() => void save()}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}保存</Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}

/** Humans and agents share the directory components and their avatar storage. */
export function MembersPage() {
  const [members, setMembers] = useState<MemberOption[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<string | null>(null);
  const [actor, setActor] = useState<{ userId: string; role: string } | null>(null), [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(false), [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [inviteError, setInviteError] = useState<string | null>(null);
  const requestId = useRef(0), submitting = useRef(false);
  const canManage = actor && ["owner", "admin"].includes(actor.role);
  const refresh = useCallback(async () => {
    const id = ++requestId.current; setLoading(true); setLoadError(null);
    try {
      const result = await api.listMembers();
      if (id !== requestId.current) return;
      setMembers(result.members.filter((member) => member.kind !== "agent")); setActor(result.actor);
    } catch (error) { if (id === requestId.current) setLoadError(error instanceof Error ? error.message : "成员加载失败"); }
    finally { if (id === requestId.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const onChange = () => void refresh();
    void refresh(); window.addEventListener("tabdo:agents-changed", onChange);
    return () => { requestId.current++; window.removeEventListener("tabdo:agents-changed", onChange); };
  }, [refresh]);
  const inviteHuman = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current || !canManage) return;
    submitting.current = true; setBusy(true); setInviteError(null);
    try { await api.inviteMember(email.trim(), "member"); toast.success("邀请已发送"); setEmail(""); setShowInvite(false); void refresh(); }
    catch (error) { setInviteError(error instanceof Error ? error.message : "邀请失败"); }
    finally { submitting.current = false; setBusy(false); }
  };
  const openInvite = () => { setEmail(""); setInviteError(null); setShowInvite(true); };
  const invite = canManage ? <Button size="sm" data-testid="members-invite-open" onClick={openInvite}><UserPlus data-icon="inline-start" />邀请成员</Button> : undefined;
  const visible = members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Dialog open={showInvite} onOpenChange={(open) => { if (!busy) setShowInvite(open); }}>
    <AppPage data-testid="members-page" className="items-center" header={<AppPageHeader page="members" description={<>邀请同事加入工作区。<Link to="/app/agents" className="underline underline-offset-2">智能体</Link>在独立页面管理。</>}>
      <Button variant="ghost" size="icon" aria-label="刷新成员" disabled={loading} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" /></Button>{invite}
    </AppPageHeader>}>
      <MemberDirectory label="成员" count={members.length} query={query} onQueryChange={setQuery} loading={loading} error={loadError} onRetry={() => void refresh()}
        empty={!members.length ? <AppEmptyState data-testid="members-empty" className="flex-1" illustration={NOTIOLY.collaborate} title="还没有成员" description="邀请同事加入工作区，一起管理表格和自动化。" action={invite} />
          : !visible.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.collaborate} title="没有匹配的成员" description="试试其他姓名或邮箱。" /> : undefined}>
        {visible.map((member) => <MemberDirectoryRow key={member.id} member={member} description={member.email}
          metadata={<Badge variant="outline">{{ owner: "所有者", admin: "管理员", member: "成员" }[member.role] ?? member.role}</Badge>}
          action={(canManage || member.userId === actor?.userId) && <MemberAvatarEditor member={member} />} />)}
      </MemberDirectory>
      <DialogContent className="max-w-md" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>邀请成员</DialogTitle><DialogDescription>通过邮箱邀请同事加入当前工作区。</DialogDescription></DialogHeader>
        <form onSubmit={inviteHuman} className="flex flex-col gap-4" data-testid="members-invite-form">
          <FieldGroup><Field data-invalid={Boolean(inviteError)}><FieldLabel htmlFor="member-invite-email">邮箱</FieldLabel>
            <Input id="member-invite-email" type="email" required disabled={busy} aria-invalid={Boolean(inviteError)} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@company.com" autoFocus />
            {inviteError && <FieldError role="alert">{inviteError}</FieldError>}
          </Field></FieldGroup>
          <Separator />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setShowInvite(false)}><X data-icon="inline-start" />取消</Button>
            <Button type="submit" disabled={busy || !email.trim()}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}{busy ? "发送中…" : "发送邀请"}</Button>
          </div>
        </form>
      </DialogContent>
    </AppPage>
  </Dialog>;
}
