import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDoc, listDocsPages } from "@/data/docs";
import { DocsMobileNav, DocsSidebar } from "./DocsSidebar";
import { DocsContent } from "./DocsContent";
import { SeoHead } from "@/components/seo/SeoHead";

export function DocsArticlePage() {
  const { t, i18n } = useTranslation("docs");
  const { slug } = useParams();
  const pages = listDocsPages(i18n.language);
  const page = slug ? getDoc(slug, i18n.language) : undefined;
  if (!page) return <Navigate to="/docs" replace />;

  const idx = pages.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx < pages.length - 1 ? pages[idx + 1] : null;

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
            <ArrowLeft className="h-3.5 w-3.5" /> {t("backHome")}
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
                className="group flex flex-1 flex-col rounded-xl border border-border bg-background p-4 transition hover:border-primary/30"
              >
                <span className="text-xs text-muted-foreground">{t("prev")}</span>
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
                className="group flex flex-1 flex-col items-end rounded-xl border border-border bg-background p-4 text-right transition hover:border-primary/30"
              >
                <span className="text-xs text-muted-foreground">{t("next")}</span>
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
