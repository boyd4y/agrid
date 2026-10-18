import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { getPost } from "@/data/blog";
import { BlogCover } from "@/components/illustrations/BlogCover";
import { SeoHead } from "@/components/seo/SeoHead";

export function BlogPostPage() {
  const { t } = useTranslation("marketing");
  const { slug } = useParams();
  const post = slug ? getPost(slug) : undefined;

  if (!post) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <SeoHead title="Not found" path="/blog" noindex />
        <p className="text-muted-foreground">{t("blog.notFound")}</p>
        <Link to="/blog" className="mt-4 inline-block text-primary">
          {t("blog.backToBlog")}
        </Link>
      </main>
    );
  }

  return (
    <main className="relative">
      <SeoHead
        title={post.title}
        description={post.excerpt}
        path={`/blog/${post.slug}`}
        type="article"
        publishedTime={post.date}
        tags={post.tags}
        image={post.coverImage}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64"
        style={{
          background:
            "radial-gradient(ellipse 50% 80% at 30% 0%, var(--tabdo-purple-soft) 0%, transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <Link
          to="/blog"
          className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("blog.back")}
        </Link>

        <div className="mb-8 overflow-hidden rounded-xl border border-border bg-muted">
          <BlogCover id={post.cover} className="aspect-[16/9] w-full" />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
            {t(`blog.categories.${post.category}`)}
          </span>
          <time dateTime={post.date}>{post.date}</time>
          <span>·</span>
          <span>{post.author}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {post.title}
        </h1>
        <p className="mt-3 text-muted-foreground">{post.excerpt}</p>
        <div className="mt-8 space-y-4 rounded-xl border border-border bg-background p-6 text-[15px] leading-7 text-foreground sm:p-8">
          {post.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </div>
    </main>
  );
}
