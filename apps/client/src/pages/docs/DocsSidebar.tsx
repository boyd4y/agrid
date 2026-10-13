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
  const nav = docsNav(i18n.language);
  const current =
    pathname === "/docs" ||
    nav.flatMap((s) => s.pages).some((p) => pathname === `/docs/${p.slug}`)
      ? pathname
      : "/docs";

  return (
    <div className="mb-6 space-y-3 lg:hidden">
      <DocsSearch />
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
    </div>
  );
}

function DocsSearch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("docs");
  const [q, setQ] = useState("");
  const results = useMemo(() => searchDocs(q, i18n.language), [q, i18n.language]);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-9 pl-8 text-sm"
          aria-label={t("searchAria")}
          data-testid="docs-search"
        />
      </div>
      {q.trim() && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-[0_8px_24px_rgba(55,53,47,0.08)]">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("noMatches")}</p>
          ) : (
            results.map((p) => (
              <Link
                key={p.slug}
                to={`/docs/${p.slug}`}
                onClick={() => setQ("")}
                className="block px-3 py-2 hover:bg-accent"
              >
                <div className="text-sm font-medium text-foreground">{p.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {p.description}
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function DocsSidebar() {
  const { t, i18n } = useTranslation("docs");
  const { pathname } = useLocation();
  const nav = docsNav(i18n.language);

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pb-8 pr-2 text-sm">
        <DocsSearch />
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
      </div>
    </aside>
  );
}
