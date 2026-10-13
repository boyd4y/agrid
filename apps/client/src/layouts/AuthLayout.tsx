import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabdoLogo } from "@/components/brand/TabdoLogo";
import { AuthOrchestrationArt } from "@/components/brand/AuthOrchestrationArt";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BRAND } from "@/lib/brand";

export function AuthLayout() {
  const { t } = useTranslation("marketing");
  const slogan = t("brand.slogan");
  const parts = slogan.includes("，") ? slogan.split("，") : [slogan, ""];
  const definition = parts[0] ?? slogan;
  const orchestration = (parts[1] ?? "").replace(/[.。]$/, "");

  return (
    <div className="relative grid min-h-svh bg-background text-foreground lg:grid-cols-[1.15fr_1fr]">
      <header className="absolute inset-x-0 top-0 flex h-24 items-center justify-between px-6 sm:px-10 lg:px-12">
        <Link to="/" aria-label={t("authAside.homeAria")} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
          <TabdoLogo />
        </Link>
        <ThemeToggle />
      </header>

      <aside className="hidden min-w-0 flex-col border-r border-border/70 bg-muted/35 px-10 pb-8 pt-28 lg:flex xl:px-16">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8">
          <p className="mb-5 text-sm font-medium text-muted-foreground">
            {t("brand.category")}
          </p>
          <h2 className="text-balance text-4xl font-semibold leading-[1.25] tracking-tight xl:text-5xl">
            {orchestration ? (
              <>
                <span className="block">{definition}，</span>
                <span className="block text-primary">{orchestration}</span>
              </>
            ) : (
              <span className="block text-primary">{definition}</span>
            )}
          </h2>
          <p className="mt-5 max-w-md text-pretty text-base leading-7 text-muted-foreground">
            {t("brand.description")}
          </p>
          <figure className="mt-8 w-full">
            <AuthOrchestrationArt />
          </figure>
        </div>
        <p className="mx-auto flex w-full max-w-xl items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono tracking-wide">Table → Do → AI</span>
          <span aria-hidden="true" className="text-border">/</span>
          <span>{t("authAside.pipeline")}</span>
        </p>
      </aside>

      <div className="flex min-w-0 flex-col px-6 pb-8 pt-28 sm:px-12 lg:pt-24">
        <div className="flex flex-1 items-center justify-center py-10">
          <main className="w-full max-w-sm">
            <Outlet />
          </main>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {BRAND.domain} <span aria-hidden="true" className="mx-2">·</span> {t("brand.category")}
        </p>
      </div>
    </div>
  );
}
