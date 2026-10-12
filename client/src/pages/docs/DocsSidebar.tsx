import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { docsNav, searchDocs } from "@/data/docs";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DocsMobileNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const nav = docsNav();
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
        <SelectTrigger aria-label="文档目录">
          <SelectValue placeholder="Browse docs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="/docs">Welcome</SelectItem>
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
  const [q, setQ] = useState("");
  const results = useMemo(() => searchDocs(q), [q]);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search docs…"
          className="h-9 pl-8 text-sm"
          aria-label="搜索文档"
          data-testid="docs-search"
        />
      </div>
      {q.trim() && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-[0_8px_24px_rgba(55,53,47,0.08)]">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
          ) : (
            results.map((p) => (
              <Link
                key={p.slug}
                to={`/docs/${p.slug}`}
                onClick={() => setQ("")}
                className="block px-3 py-2 hover:bg-black/5"
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
  const { pathname } = useLocation();
  const nav = docsNav();

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pb-8 pr-2 text-sm">
        <DocsSearch />
        <Link
          to="/docs"
          className={cn(
            "block rounded-md px-2 py-1.5 font-medium",
            pathname === "/docs"
              ? "bg-black/5 text-foreground"
              : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
          )}
        >
          文档首页
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
                          ? "bg-black/5 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
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
