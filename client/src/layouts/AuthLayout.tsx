import { Link, Outlet } from "react-router-dom";
import { TabdoLogo } from "@/components/brand/TabdoLogo";
import { AuthOrchestrationArt } from "@/components/brand/AuthOrchestrationArt";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BRAND, BRAND_COPY } from "@/lib/brand";

export function AuthLayout() {
  const [definition, orchestration] = BRAND_COPY.slogan.split("，");

  return (
    <div className="relative grid min-h-svh bg-background text-foreground lg:grid-cols-[1.15fr_1fr]">
      <header className="absolute inset-x-0 top-0 flex h-24 items-center justify-between px-6 sm:px-10 lg:px-12">
        <Link to="/" aria-label="tabdo 首页" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
          <TabdoLogo />
        </Link>
        <ThemeToggle />
      </header>

      <aside className="hidden min-w-0 flex-col border-r border-border/70 bg-muted/35 px-10 pb-8 pt-28 lg:flex xl:px-16">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8">
          <p className="mb-5 text-sm font-medium text-muted-foreground">
            {BRAND_COPY.category}
          </p>
          <h2 className="text-balance text-4xl font-semibold leading-[1.25] tracking-tight xl:text-5xl">
            <span className="block">{definition}，</span>
            <span className="block text-primary">{orchestration}</span>
          </h2>
          <p className="mt-5 max-w-md text-pretty text-base leading-7 text-muted-foreground">
            {BRAND_COPY.description}
          </p>
          <figure className="mt-8 w-full">
            <AuthOrchestrationArt />
          </figure>
        </div>
        <p className="mx-auto flex w-full max-w-xl items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono tracking-wide">Table → Do → AI</span>
          <span aria-hidden="true" className="text-border">/</span>
          <span>从想法，到行动</span>
        </p>
      </aside>

      <div className="flex min-w-0 flex-col px-6 pb-8 pt-28 sm:px-12 lg:pt-24">
        <div className="flex flex-1 items-center justify-center py-10">
          <main className="w-full max-w-sm">
            <Outlet />
          </main>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {BRAND.domain} <span aria-hidden="true" className="mx-2">·</span> {BRAND_COPY.category}
        </p>
      </div>
    </div>
  );
}
