import { Link } from "react-router-dom";
import { NiBot, NiBook, NiSparkles, NiZap } from "@/components/icons";
import { docsNav, getDoc } from "@/data/docs";
import { DocsContent } from "./DocsContent";
import { DocsMobileNav, DocsSidebar } from "./DocsSidebar";
import { SeoHead } from "@/components/seo/SeoHead";

export function DocsIndexPage() {
  const welcome = getDoc("welcome");
  const nav = docsNav();
  const agents = nav.find((s) => s.id === "agents");
  const humans = nav.find((s) => s.id === "humans");
  const refs = nav.find((s) => s.id === "reference");

  return (
    <main className="relative">
      <SeoHead
        title="Documentation"
        description="tabdo docs — For AI Agents (MCP, Skill) and For Humans (UI, API). Same command layer."
        path="/docs"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80"
        style={{
          background:
            "radial-gradient(ellipse 55% 70% at 75% 0%, var(--tabdo-blue-soft) 0%, transparent 55%), radial-gradient(ellipse 45% 55% at 15% 10%, var(--tabdo-purple-soft) 0%, transparent 50%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <DocsMobileNav />
        <div className="flex gap-10">
          <DocsSidebar />
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-primary">
              Documentation
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">
              tabdo is Agent-first Talk-to-Build: chat builds the system; Grid / Board
              stay the core data view. Pick your path — no login required to read.
            </p>

            {/* Dual entry — monid pattern */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <Link
                to="/docs/mcp"
                className="group rounded-2xl border border-border bg-background p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--tabdo-blue-soft)]">
                  <NiBot className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-lg font-semibold group-hover:text-primary">
                  For AI Agents
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  External: MCP + Skill. In-product: Vercel harness built-in tools.
                  Same command layer either way.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {(agents?.pages ?? []).slice(0, 3).map((p) => (
                    <li key={p.slug} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{p.title}</span>
                      {" — "}
                      {p.description}
                    </li>
                  ))}
                </ul>
              </Link>

              <Link
                to="/docs/human-quickstart"
                className="group rounded-2xl border border-border bg-background p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--tabdo-yellow-soft)]">
                  <NiBook className="h-5 w-5 text-[var(--tabdo-yellow)]" />
                </div>
                <h2 className="text-lg font-semibold group-hover:text-primary">
                  For Humans
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  /app opens Talk-to-Build + tables. Full grid, kanban, filters
                  unchanged on each table.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {(humans?.pages ?? []).slice(0, 3).map((p) => (
                    <li key={p.slug} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{p.title}</span>
                      {" — "}
                      {p.description}
                    </li>
                  ))}
                </ul>
              </Link>
            </div>

            {/* Setup strips */}
            <h2 className="mt-12 text-xl font-semibold tracking-tight">
              Setup for AI Agents
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Link
                to="/docs/harness"
                className="rounded-xl border border-border bg-background p-4 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <NiZap className="h-4 w-4 text-primary" /> Harness
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  In-app Codex / Claude / Pi built-in tools.
                </p>
              </Link>
              <Link
                to="/docs/mcp"
                className="rounded-xl border border-border bg-background p-4 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <NiSparkles className="h-4 w-4 text-primary" /> MCP
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  External agents via stdio MCP.
                </p>
              </Link>
              <Link
                to="/docs/skill"
                className="rounded-xl border border-border bg-background p-4 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <NiBot className="h-4 w-4 text-primary" /> Skill
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  External table-ops skill.
                </p>
              </Link>
            </div>

            <h2 className="mt-10 text-xl font-semibold tracking-tight">
              Setup for Humans
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link
                to="/docs/human-quickstart"
                className="rounded-xl border border-border bg-background p-4 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <NiBook className="h-4 w-4" /> Workspace
                </div>
                <p className="mt-1 text-sm text-muted-foreground">UI walkthrough</p>
              </Link>
              <Link
                to="/docs/api-quickstart"
                className="rounded-xl border border-border bg-background p-4 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <NiZap className="h-4 w-4" /> API
                </div>
                <p className="mt-1 text-sm text-muted-foreground">POST /api/commands</p>
              </Link>
            </div>

            <h2 className="mt-10 text-xl font-semibold tracking-tight">References</h2>
            <ul className="mt-3 space-y-2">
              {(refs?.pages ?? []).map((p) => (
                <li key={p.slug}>
                  <Link
                    to={`/docs/${p.slug}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {p.title}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {" "}
                    — {p.description}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-10 text-xs text-muted-foreground">
              Agent index:{" "}
              <a className="underline hover:text-foreground" href="/docs/llms.txt">
                /docs/llms.txt
              </a>{" "}
              ·{" "}
              <a className="underline hover:text-foreground" href="/llms.txt">
                /llms.txt
              </a>
            </p>

            {welcome ? (
              <div className="mt-12 border-t border-border pt-8">
                <DocsContent
                  blocks={welcome.body.filter((b) => b.type !== "cards")}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
