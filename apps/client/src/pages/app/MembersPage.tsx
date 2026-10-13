import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Loader2, UserPlus, X, Send, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldLabel, FieldGroup, FieldError } from "@tabdo/ui/components/field";
import { Separator } from "@tabdo/ui/components/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/controls/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { useArrayPagination } from "@/hooks/useListPagination";
import { ListPagination } from "@/components/controls/list-pagination";
import { MemberDirectory, MemberDirectoryRow } from "@/components/members/MemberDirectory";
import { AvatarPicker } from "@/components/members/AvatarPicker";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";

function MemberAvatarEditor({ member }: { member: MemberOption }) {
  const { t } = useTranslation(["app", "common", "errors"]);
  const [open, setOpen] = useState(false), [image, setImage] = useState(member.image ?? null);
  const [busy, setBusy] = useState(false), [processing, setProcessing] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const save = async () => {
    if (submitting.current || processing || image === (member.image ?? null)) return;
    submitting.current = true; setBusy(true); setError(null);
    try { await api.updateMemberAvatar(member.id, image); toast.success(t("members.avatarSaved")); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : t("errors:avatarSaveFailed")); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Popover open={open} onOpenChange={(next) => { if (!busy && !processing) { if (next) { setImage(member.image ?? null); setError(null); } setOpen(next); } }}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" aria-label={t("members.editAvatarAria", { name: member.name })}><ImagePlus data-icon="inline-start" />{t("members.changeAvatar")}</Button></PopoverTrigger>
    <PopoverContent className="w-96 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto" align="end" aria-label={t("members.editAvatarPopover")}>
      <div className="flex flex-col gap-4">
        <AvatarPicker name={member.name} image={image} onChange={setImage} disabled={busy} onProcessingChange={setProcessing} />
        {error && <FieldError role="alert">{error}</FieldError>}
        <Separator />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy || processing} onClick={() => setOpen(false)}><X data-icon="inline-start" />{t("common:cancel")}</Button>
          <Button size="sm" disabled={busy || processing || image === (member.image ?? null)} onClick={() => void save()}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{t("common:save")}</Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}

/** Humans and agents share the directory components and their avatar storage. */
export function MembersPage() {
  const { t } = useTranslation(["app", "common", "errors"]);
  const [members, setMembers] = useState<MemberOption[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<string | null>(null);
  const [actor, setActor] = useState<{ userId: string; role: string } | null>(null), [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(false), [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [inviteError, setInviteError] = useState<string | null>(null);
  const requestId = useRef(0), submitting = useRef(false);
  const canManage = actor && ["owner", "admin"].includes(actor.role);
  const roleLabel = (role: string) =>
    ({ owner: t("members.roleOwner"), admin: t("members.roleAdmin"), member: t("members.roleMember") }[role] ?? role);
  const refresh = useCallback(async () => {
    const id = ++requestId.current; setLoading(true); setLoadError(null);
    try {
      const result = await api.listMembers();
      if (id !== requestId.current) return;
      setMembers(result.members.filter((member) => member.kind !== "agent")); setActor(result.actor);
    } catch (error) { if (id === requestId.current) setLoadError(error instanceof Error ? error.message : t("errors:membersLoadFailed")); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [t]);
  useEffect(() => {
    const onChange = () => void refresh();
    void refresh(); window.addEventListener("tabdo:agents-changed", onChange);
    return () => { requestId.current++; window.removeEventListener("tabdo:agents-changed", onChange); };
  }, [refresh]);
  const inviteHuman = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current || !canManage) return;
    submitting.current = true; setBusy(true); setInviteError(null);
    try { await api.inviteMember(email.trim(), "member"); toast.success(t("members.inviteSent")); setEmail(""); setShowInvite(false); void refresh(); }
    catch (error) { setInviteError(error instanceof Error ? error.message : t("errors:inviteFailed")); }
    finally { submitting.current = false; setBusy(false); }
  };
  const openInvite = () => { setEmail(""); setInviteError(null); setShowInvite(true); };
  const invite = canManage ? <Button size="sm" data-testid="members-invite-open" onClick={openInvite}><UserPlus data-icon="inline-start" />{t("members.invite")}</Button> : undefined;
  const visible = members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pagination = useArrayPagination(visible);
  useEffect(() => pagination.resetPage(), [query, pagination.resetPage]);
  return <Dialog open={showInvite} onOpenChange={(open) => { if (!busy) setShowInvite(open); }}>
    <AppPage contentWidth="standard" data-testid="members-page" className="items-center" header={<AppPageHeader page="members" description={<>{t("members.descriptionBefore")}<Link to="/app/agents" className="underline underline-offset-2">{t("members.descriptionLink")}</Link>{t("members.descriptionAfter")}</>}>
      <Button variant="ghost" size="icon" aria-label={t("members.refreshAria")} disabled={loading} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" /></Button>{invite}
    </AppPageHeader>}>
      <MemberDirectory label={t("nav.members")} count={members.length} query={query} onQueryChange={setQuery} loading={loading} error={loadError} onRetry={() => void refresh()}
        pagination={visible.length > 0 && <ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />}
        empty={!members.length ? <AppEmptyState data-testid="members-empty" className="flex-1" illustration={NOTIOLY.collaborate} title={t("members.emptyTitle")} description={t("members.emptyDescription")} action={invite} />
          : !visible.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.collaborate} title={t("members.noMatchTitle")} description={t("members.noMatchDescription")} /> : undefined}>
        {pagination.items.map((member) => <MemberDirectoryRow key={member.id} member={member} description={member.email}
          metadata={<Badge variant="outline">{roleLabel(member.role)}</Badge>}
          action={(canManage || member.userId === actor?.userId) && <MemberAvatarEditor member={member} />} />)}
      </MemberDirectory>
      <DialogContent className="max-w-md" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t("members.inviteTitle")}</DialogTitle><DialogDescription>{t("members.inviteDescription")}</DialogDescription></DialogHeader>
        <form onSubmit={inviteHuman} className="flex flex-col gap-4" data-testid="members-invite-form">
          <FieldGroup><Field data-invalid={Boolean(inviteError)}><FieldLabel htmlFor="member-invite-email">{t("members.email")}</FieldLabel>
            <Input id="member-invite-email" type="email" required disabled={busy} aria-invalid={Boolean(inviteError)} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("members.emailPlaceholder")} autoFocus />
            {inviteError && <FieldError role="alert">{inviteError}</FieldError>}
          </Field></FieldGroup>
          <Separator />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setShowInvite(false)}><X data-icon="inline-start" />{t("common:cancel")}</Button>
            <Button type="submit" disabled={busy || !email.trim()}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}{busy ? t("members.sending") : t("members.sendInvite")}</Button>
          </div>
        </form>
      </DialogContent>
    </AppPage>
  </Dialog>;
}
