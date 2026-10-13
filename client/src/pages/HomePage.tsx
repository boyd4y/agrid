import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  NiArrowRight,
  NiBot,
  NiKanban,
  NiSparkles,
  NiTable,
  NiUsers,
  NiZap,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BRAND_COPY } from "@/lib/brand";
import { NotiolyImage, NOTIOLY } from "@/components/illustrations/NotiolyImage";

const surfaces = [
  { label: "说出想法", hint: "告诉 AI 你想做什么" },
  { label: "整理信息", hint: "把已有的信息放在一起" },
  { label: "安排步骤", hint: "一起理清下一步" },
  { label: "动手执行", hint: "让 AI 操作，随时查看和调整" },
];

export function HomePage() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-[1.2fr_1fr] lg:py-20">
          <div className="min-w-0">
            <Badge variant="outline" className="mb-4 h-7 rounded-full px-3 text-xs font-normal">
              tabdo · {BRAND_COPY.category}
            </Badge>
            <h1 className="text-balance text-[2.75rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem]">
              {BRAND_COPY.slogan}
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {BRAND_COPY.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">
                  开始使用 <NiArrowRight data-icon="inline-end" className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">查看使用指南</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              {surfaces.map((s) => (
                <Badge
                  key={s.label}
                  variant="outline"
                  className="h-7 rounded-full px-3 text-xs font-normal"
                  title={s.hint}
                >
                  {s.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm md:max-w-md">
            <NotiolyImage
              src={NOTIOLY.fastInternet}
              alt="坐在火箭上使用电脑的人物"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* Ideas, AI assistance, and everyday work */}
      <section className="bg-muted/60 py-14 lg:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              有了想法，就让 AI 帮你动手
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              想整理一次旅行，或推进一个小组项目？把想做的事和已有信息告诉 tabdo。
              让 AI 帮你理清内容、安排步骤，再动手更新记录和设置规则。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SurfaceCard
              icon={<NiSparkles className="h-5 w-5 text-primary" />}
              title="说出想做的事，一起理清下一步"
              body="把零散的想法和资料放进工作区，让 AI 帮你整理信息、安排步骤。需要添加记录、修改内容或调整状态时，接着对话就能让它动手。"
              cta={{ to: "/docs/harness", label: "了解 AI 助手" }}
              badge="AI 动手"
            />
            <SurfaceCard
              icon={<NiBot className="h-5 w-5 text-primary" />}
              title="随时看看，也随时改改"
              body="AI 做了什么，结果就在工作区里。你可以查看记录，直接修改，也可以停下来换个方向，再告诉它下一步怎么做。"
              cta={{ to: "/docs", label: "查看使用指南" }}
              badge="你来决定"
            />
          </div>
        </div>
      </section>

      {/* Everyday examples and supporting capabilities */}
      <section className="border-y border-border py-14 lg:py-16">
        <div className="mx-auto max-w-6xl space-y-16 px-4 lg:space-y-20">
          <DeepDive
            icon={<NiTable className="h-5 w-5" />}
            title="旅行安排，从零散信息开始"
            body="把想去的地方、日期和预算记下来，让 AI 帮你整理已有信息和待办事项。计划有变化时，直接更新记录，或用对话调整安排。"
            cta={{ to: "/signup", label: "开始一个计划" }}
            art={<NotiolyImage src={NOTIOLY.painting} alt="在画布上开始创作" />}
          />
          <DeepDive
            reverse
            icon={<NiZap className="h-5 w-5" />}
            title="小组项目，下一步清清楚楚"
            body="整理任务、负责人和进展，让 AI 协助安排步骤、更新状态。和同伴一起查看、修改，项目往前走，信息也能跟着更新。"
            cta={{ to: "/docs", label: "看看如何使用" }}
            art={<NotiolyImage src={NOTIOLY.planning} alt="规划与构建" />}
          />
          <DeepDive
            icon={<NiKanban className="h-5 w-5" />}
            title="给想法合适的工具"
            body="用表单收集意见，用看板查看进展，用报告汇总结果。重复的记录更新可以设成自动化规则，也可以交给 AI 执行；你随时能查看和调整。"
            cta={{ to: "/docs", label: "了解工作区功能" }}
            art={<NotiolyImage src={NOTIOLY.collaborate} alt="协作" />}
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
                一个人用，也能和小团队一起用
              </h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                在自己的工作区里整理想法，也可以邀请同伴一起参与。
                按需要配置 AI 助手，让它用合适的方法和工具帮你做事。
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 lg:mt-0 lg:justify-end">
              <Button asChild size="lg">
                <Link to="/signup">创建工作区</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">查看使用指南</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-14 lg:py-16">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 45% 50% at 50% 100%, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            从一件想做的事开始
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground leading-relaxed">
            告诉 tabdo 你的想法，把已有的信息放进来，让 AI 帮你迈出下一步。
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">
                开始使用 <NiArrowRight data-icon="inline-end" className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/blog">阅读博客</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            想法由你开始，方向由你决定。
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
        <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wide">
          {badge}
        </Badge>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button asChild variant="ghost" className="mt-3 h-auto px-0 text-primary underline-offset-4 hover:underline">
        <Link to={cta.to}>
          {cta.label} <NiArrowRight data-icon="inline-end" className="size-4" />
        </Link>
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
          <Link to={cta.to}>
            {cta.label} <NiArrowRight data-icon="inline-end" className="size-4" />
          </Link>
        </Button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-muted/40 p-2 sm:p-3">{art}</div>
    </div>
  );
}
