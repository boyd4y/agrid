import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { MemberAvatar } from "./MemberAvatar";
import type { MemberOption } from "@/lib/api";

export function MemberDirectory({ label, count, query, onQueryChange, loading, error, onRetry, empty, children }: {
  label: string; count: number; query: string; onQueryChange: (query: string) => void;
  loading: boolean; error: string | null; onRetry: () => void; empty?: ReactNode; children: ReactNode;
}) {
  const { t } = useTranslation(["app", "common"]);
  return <div className="flex w-full max-w-6xl flex-1 flex-col gap-5" data-testid="member-directory">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="relative w-full max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={t("directory.searchAria", { label })} placeholder={t("directory.searchPlaceholder", { label })} className="pl-9" value={query} disabled={loading && count === 0} onChange={(e) => onQueryChange(e.target.value)} />
      </label>
      <p className="text-sm text-muted-foreground">{loading ? t("common:loading") : error ? t("directory.loadFailed") : t("directory.count", { count, label })}</p>
    </div>
    {loading ? <div role="status" aria-label={t("directory.loadingLabel", { label })} className="flex flex-col gap-3">{[0, 1, 2].map((id) => <Skeleton key={id} className="h-28 w-full" />)}</div>
      : error ? <ListErrorState title={t("directory.loadFailed")} description={error} onRetry={onRetry} />
      : empty ?? <ul className="divide-y rounded-xl border bg-card">{children}</ul>}
  </div>;
}

export function MemberDirectoryRow({ member, title, description, metadata, action }: {
  member: MemberOption; title?: ReactNode; description: ReactNode; metadata?: ReactNode; action?: ReactNode;
}) {
  return <li className="flex items-start gap-4 p-5" data-testid="member-directory-row">
    <MemberAvatar name={member.name} image={member.image} kind={member.kind} />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h2 className="truncate font-medium">{title ?? member.name}</h2>
      <div className="line-clamp-2 break-words text-sm text-muted-foreground">{description}</div>
      {metadata && <div className="flex flex-wrap items-center gap-2">{metadata}</div>}
    </div>
    {action}
  </li>;
}
