import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { docsNav, searchDocs } from "@/data/docs";
import { cn } from "@/lib/utils";
import { Input } from "@tabdo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";

export function DocsMobileNav() {
  const { t, i18n } = useTranslation("docs");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const nav = docsNav(i18n.language);
  const current =
    pathname === "/docs" ||
    nav.flatMap((s) => s.pages).some((p) => pathname === `/docs/${p.slug}`)
      ? pathname
      : "/docs";

  return (
    <div className="mb-6 flex flex-col gap-3 lg:hidden">
      <DocsSearch q={q} onQueryChange={setQ} />
      {q.trim() ? <DocsSearchResults q={q} /> : (
        <Select
          value={current}
          onValueChange={(v) => {
            if (v) navigate(v);
          }}
        >
          <SelectTrigger aria-label={t("tocAria")}>
            <SelectValue placeholder={t("browse")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="/docs">{t("welcomeNav")}</SelectItem>
            {nav.map((section) =>
              section.pages.map((p) => (
                <SelectItem key={p.slug} value={`/docs/${p.slug}`}>
                  {section.title} · {p.title}
                </SelectItem>
              ))
            )}
        </SelectContent>
      </Select>
      )}
    </div>
  );
}

function DocsSearch({ q, onQueryChange }: { q: string; onQueryChange: (q: string) => void }) {
  const { t } = useTranslation("docs");
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="h-9 pl-8 text-sm"
        aria-label={t("searchAria")}
        data-testid="docs-search"
      />
    </div>
  );
}

function DocsSearchResults({ q }: { q: string }) {
  const { t, i18n } = useTranslation("docs");
  const { pathname } = useLocation();
  const results = useMemo(() => searchDocs(q, i18n.language), [q, i18n.language]);
  return (
    <nav aria-label={t("tocAria")}>
      {results.length === 0 ? (
        <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {results.map((p) => (
            <li key={p.slug}>
              <Link
                to={`/docs/${p.slug}`}
                aria-current={pathname === `/docs/${p.slug}` ? "page" : undefined}
                className="block rounded-md px-2 py-2 hover:bg-accent aria-[current=page]:bg-accent"
              >
                <div className="text-sm font-medium text-foreground">{p.title}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export function DocsSidebar() {
  const [q, setQ] = useState("");
  const { t, i18n } = useTranslation("docs");
  const { pathname } = useLocation();
  const nav = docsNav(i18n.language);

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pb-8 pr-2 text-sm">
        <DocsSearch q={q} onQueryChange={setQ} />
        {q.trim() ? <DocsSearchResults q={q} /> : (
          <>
            <Link
              to="/docs"
              className={cn(
                "block rounded-md px-2 py-1.5 font-medium",
                pathname === "/docs"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t("home")}
            </Link>
            {nav.map((section) => (
              <div key={section.id}>
                <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.pages.map((p) => {
                    const to = `/docs/${p.slug}`;
                    const active = pathname === to;
                    return (
                      <li key={p.slug}>
                        <Link
                          to={to}
                          className={cn(
                            "block rounded-md px-2 py-1.5",
                            active
                              ? "bg-accent font-medium text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        >
                          {p.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
