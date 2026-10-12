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
import { NotiolyImage, NOTIOLY } from "@/components/illustrations/NotiolyImage";

const surfaces = [
  { label: "Talk-to-Build", hint: "对话建系统" },
  { label: "Grid / Board", hint: "核心数据视图" },
  { label: "Harness tools", hint: "产品内 Codex·Claude·Pi" },
  { label: "MCP + Skill", hint: "外部 Agent" },
];

export function HomePage() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-[1.2fr_1fr] lg:py-20">
          <div className="min-w-0">
            <Badge variant="outline" className="mb-4 h-7 rounded-full px-3 text-xs font-normal">
              Agrid · Agent-first · Talk-to-Build
            </Badge>
            <h1 className="text-balance text-[2.75rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem]">
              用对话构建数据系统，
              <span className="text-primary">用表格落盘</span>
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Agrid 不是「多维表格再套一层 AI」。底层是 Postgres 表格与看板——这是核心数据展示；
              默认路径是 Talk-to-Build：说需求，Agent 建表、列、自动化与公式。人看网格，Agent 写命令。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">
                  免费开始 <NiArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">文档 · For Agents / Humans</Link>
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

      {/* Dual agent surfaces */}
      <section className="bg-muted/60 py-14 lg:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              两套 Agent 入口，一套命令层
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              产品内用 Vercel Harness 的内置 tools；对外用 MCP + Skill。
              UI、Harness、MCP、agt_ Key 全部落到同一 <code className="rounded-md bg-background px-1.5 py-0.5 text-sm">/api/commands</code>。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SurfaceCard
              icon={<NiSparkles className="h-5 w-5 text-primary" />}
              title="产品内 · Vercel Harness"
              body="Codex / Claude / Pi 可切换。assistant-ui 对话直接带内置 table tools——建表、改单元格、移看板。无需 MCP。"
              cta={{ to: "/docs/harness", label: "Harness 内置 tools" }}
              badge="Internal"
            />
            <SurfaceCard
              icon={<NiBot className="h-5 w-5 text-primary" />}
              title="对外 · MCP + Skill"
              body="Claude、Codex、Cursor 等外部 Agent 通过 @table/mcp 与 table-ops Skill 接入。工具与内置 tools 1:1。"
              cta={{ to: "/docs/mcp", label: "给外部 Agent" }}
              badge="External"
            />
          </div>
        </div>
      </section>

      {/* Table is core */}
      <section className="border-y border-border py-14 lg:py-16">
        <div className="mx-auto max-w-6xl space-y-16 px-4 lg:space-y-20">
          <DeepDive
            icon={<NiTable className="h-5 w-5" />}
            title="表格仍是核心底层与主展示"
            body="Agent 优先的是「怎么建、怎么改」，不是取代网格。对话建完后默认落到 Grid / Board；10 万行级虚拟滚动与游标分页撑住检查与审计。"
            cta={{ to: "/docs/tables", label: "字段与性能" }}
            art={<NotiolyImage src={NOTIOLY.painting} alt="在画布上开始创作" />}
          />
          <DeepDive
            reverse
            icon={<NiZap className="h-5 w-5" />}
            title="Talk-to-Build：一句话出系统"
            body="「做个 CRM，跟进自动化」→ 建表、关联列、自动化、公式。登录后 /app 默认就是对话构建 + 实时表格，不用先拖拽低代码。"
            cta={{ to: "/signup", label: "打开工作台" }}
            art={<NotiolyImage src={NOTIOLY.planning} alt="规划与构建" />}
          />
          <DeepDive
            icon={<NiKanban className="h-5 w-5" />}
            title="自动化 · 公式 · 看板同一数据源"
            body="当/如果/就自动化、公式列、看板移卡——人和 Agent 共用。person 列可指到员工或智能体成员。"
            cta={{ to: "/docs/architecture", label: "同源架构" }}
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
                员工与智能体，同一张成员表
              </h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                人机同权：user.kind 区分形态，member.role 决定权限。操作接口 1:1，不给人一套、给模型一套。
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 lg:mt-0 lg:justify-end">
              <Button asChild size="lg">
                <Link to="/signup">创建工作区</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/docs">For Agents / Humans</Link>
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
            对话构建 · 表格落盘
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground leading-relaxed">
            Agrid：Agent-first 数据系统。注册后直接进入 Talk-to-Build。
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">
                免费开始 <NiArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/blog">阅读博客</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            演示账号 demo@agrid.app · Demo1234!
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
          {cta.label} <NiArrowRight className="h-4 w-4" />
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
            {cta.label} <NiArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-muted/40 p-2 sm:p-3">{art}</div>
    </div>
  );
}
