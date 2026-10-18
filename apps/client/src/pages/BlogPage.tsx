import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  blogCategories,
  blogPosts,
  type BlogCategory,
} from "@/data/blog";
import { BlogCover } from "@/components/illustrations/BlogCover";
import { SeoHead } from "@/components/seo/SeoHead";
import { cn } from "@/lib/utils";

export function BlogPage() {
  const { t } = useTranslation("marketing");
  const [cat, setCat] = useState<BlogCategory | "All">("All");
  const posts = useMemo(
    () =>
      cat === "All" ? blogPosts : blogPosts.filter((p) => p.category === cat),
    [cat]
  );

  return (
    <main className="relative">
      <SeoHead
        title={t("blog.seoTitle")}
        description={t("blog.seoDescription")}
        path="/blog"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 70% 0%, var(--tabdo-green-soft) 0%, transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-5xl px-4 py-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("blog.title")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("blog.subtitle")}
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          {(["All", ...blogCategories] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition motion-reduce:transition-none",
                cat === c
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {c === "All" ? t("blog.all") : t(`blog.categories.${c}`)}
            </button>
          ))}
        </div>

        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link
                to={`/blog/${p.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background/90 transition motion-reduce:transition-none hover:border-foreground/20"
              >
                <div className="aspect-[16/9] w-full overflow-hidden border-b border-border bg-muted">
                  <BlogCover
                    id={p.cover}
                    className="h-full w-full object-cover transition motion-reduce:transition-none duration-300 group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-primary">{t(`blog.categories.${p.category}`)}</span>
                    <span>·</span>
                    <time dateTime={p.date}>{p.date}</time>
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight group-hover:text-primary">
                    {p.title}
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {p.excerpt}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-xs text-muted-foreground">
          {t("blog.machineIndex")}{" "}
          <a className="underline hover:text-foreground" href="/llms.txt">
            /llms.txt
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-foreground" href="/sitemap.xml">
            sitemap.xml
          </a>
        </p>
      </div>
    </main>
  );
}
