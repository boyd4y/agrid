import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { docsPages, getDoc } from "@/data/docs";
import { DocsMobileNav, DocsSidebar } from "./DocsSidebar";
import { DocsContent } from "./DocsContent";
import { SeoHead } from "@/components/seo/SeoHead";

export function DocsArticlePage() {
  const { slug } = useParams();
  const page = slug ? getDoc(slug) : undefined;
  if (!page) return <Navigate to="/docs" replace />;

  const idx = docsPages.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? docsPages[idx - 1] : null;
  const next = idx < docsPages.length - 1 ? docsPages[idx + 1] : null;

  return (
    <main className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56"
        style={{
          background:
            "radial-gradient(ellipse 50% 80% at 80% 0%, #F1E3B7 0%, transparent 55%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <DocsMobileNav />
        <div className="flex gap-10">
        <DocsSidebar />
        <article className="min-w-0 flex-1">
          <SeoHead
            title={page.title}
            description={page.description}
            path={`/docs/${page.slug}`}
          />
          <Link
            to="/docs"
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Welcome
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          <p className="mt-2 text-muted-foreground">{page.description}</p>
          <div className="mt-8">
            <DocsContent blocks={page.body} />
          </div>

          <nav className="mt-14 flex items-stretch justify-between gap-4 border-t border-border pt-6">
            {prev ? (
              <Link
                to={`/docs/${prev.slug}`}
                className="group flex flex-1 flex-col rounded-xl border border-border bg-background p-4 transition hover:border-[var(--notion-blue)]/30"
              >
                <span className="text-xs text-muted-foreground">上一篇</span>
                <span className="mt-1 inline-flex items-center gap-1 font-medium group-hover:text-primary">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {prev.title}
                </span>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
            {next ? (
              <Link
                to={`/docs/${next.slug}`}
                className="group flex flex-1 flex-col items-end rounded-xl border border-border bg-background p-4 text-right transition hover:border-[var(--notion-blue)]/30"
              >
                <span className="text-xs text-muted-foreground">下一篇</span>
                <span className="mt-1 inline-flex items-center gap-1 font-medium group-hover:text-primary">
                  {next.title}
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
          </nav>
        </article>
        </div>
      </div>
    </main>
  );
}
