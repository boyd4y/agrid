import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  NiArrowRight,
  NiBot,
  NiKanban,
  NiSparkles,
  NiTable,
  NiUsers,
  NiZap,
} from "@/components/icons";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { NotiolyImage, NOTIOLY } from "@/components/illustrations/NotiolyImage";

export function HomePage() {
  const { t } = useTranslation("marketing");
  const surfaces = [
    { key: "speak" as const },
    { key: "organize" as const },
    { key: "plan" as const },
    { key: "act" as const },
  ];

  return (
    <main>
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-[1.2fr_1fr] lg:py-20">
          <div className="min-w-0">
            <Badge variant="outline" className="mb-4 h-7 rounded-full px-3 text-xs font-normal">
              tabdo · {t("brand.category")}
            </Badge>
            <h1 className="text-balance text-[2.75rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem]">
              {t("brand.slogan")}
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t("brand.description")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">
                  {t("hero.getStarted")} <NiArrowRight data-icon="inline-end" className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">{t("hero.viewGuide")}</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              {surfaces.map((s) => (
                <Badge
                  key={s.key}
                  variant="outline"
                  className="h-7 rounded-full px-3 text-xs font-normal"
                  title={t(`surfaces.${s.key}.hint`)}
                >
                  {t(`surfaces.${s.key}.label`)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm md:max-w-md">
            <NotiolyImage
              src={NOTIOLY.fastInternet}
              alt={t("hero.rocketAlt")}
              loading="eager"
            />
          </div>
        </div>
      </section>

      <section className="bg-muted/60 py-14 lg:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("ideas.title")}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("ideas.body")}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SurfaceCard
              icon={<NiSparkles className="h-5 w-5 text-primary" />}
              title={t("ideas.card1Title")}
              body={t("ideas.card1Body")}
              cta={{ to: "/docs/harness", label: t("ideas.card1Cta") }}
              badge={t("ideas.card1Badge")}
            />
            <SurfaceCard
              icon={<NiBot className="h-5 w-5 text-primary" />}
              title={t("ideas.card2Title")}
              body={t("ideas.card2Body")}
              cta={{ to: "/docs", label: t("ideas.card2Cta") }}
              badge={t("ideas.card2Badge")}
            />
          </div>
        </div>
      </section>

      <section className="border-y border-border py-14 lg:py-16">
        <div className="mx-auto max-w-6xl space-y-16 px-4 lg:space-y-20">
          <DeepDive
            icon={<NiTable className="h-5 w-5" />}
            title={t("examples.travelTitle")}
            body={t("examples.travelBody")}
            cta={{ to: "/signup", label: t("examples.travelCta") }}
            art={<NotiolyImage src={NOTIOLY.painting} alt={t("examples.travelAlt")} />}
          />
          <DeepDive
            reverse
            icon={<NiZap className="h-5 w-5" />}
            title={t("examples.projectTitle")}
            body={t("examples.projectBody")}
            cta={{ to: "/docs", label: t("examples.projectCta") }}
            art={<NotiolyImage src={NOTIOLY.planning} alt={t("examples.projectAlt")} />}
          />
          <DeepDive
            icon={<NiKanban className="h-5 w-5" />}
            title={t("examples.toolsTitle")}
            body={t("examples.toolsBody")}
            cta={{ to: "/docs", label: t("examples.toolsCta") }}
            art={<NotiolyImage src={NOTIOLY.collaborate} alt={t("examples.toolsAlt")} />}
          />
        </div>
      </section>

      <section className="bg-muted/60 py-12 lg:py-14">
        <div className="mx-auto max-w-6xl px-4">
          <div className="rounded-3xl border border-border bg-background p-8 shadow-sm sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-12">
            <div className="max-w-xl">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <NiUsers className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("team.title")}
              </h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                {t("team.body")}
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 lg:mt-0 lg:justify-end">
              <Button asChild size="lg">
                <Link to="/signup">{t("team.createWorkspace")}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">{t("team.viewGuide")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 lg:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("cta.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground leading-relaxed">
            {t("cta.body")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">{t("cta.getStarted")}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/blog">{t("cta.readBlog")}</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            {t("cta.footnote")}
          </p>
        </div>
      </section>
    </main>
  );
}

function SurfaceCard({
  icon,
  title,
  body,
  cta,
  badge,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta: { to: string; label: string };
  badge: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted">
          {icon}
        </div>
        <Badge variant="outline" className="text-[10px] font-normal">
          {badge}
        </Badge>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button asChild variant="ghost" className="mt-3 h-auto px-0 text-primary underline-offset-4 hover:underline">
        <Link to={cta.to}>{cta.label}</Link>
      </Button>
    </div>
  );
}

function DeepDive({
  icon,
  title,
  body,
  cta,
  art,
  reverse = false,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta: { to: string; label: string };
  art: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${
        reverse ? "lg:[&>*:first-child]:order-2" : ""
      }`}
    >
      <div>
        <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
          {icon}
        </div>
        <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h3>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{body}</p>
        <Button asChild variant="ghost" className="mt-4 h-auto px-0 underline-offset-4 hover:underline">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-muted/40 p-2 sm:p-3">{art}</div>
    </div>
  );
}
