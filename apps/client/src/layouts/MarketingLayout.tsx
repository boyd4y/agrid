import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabdoLogo } from "@/components/brand/TabdoLogo";
import { Button } from "@tabdo/ui/components/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BRAND } from "@/lib/brand";

export function MarketingLayout() {
  const { t } = useTranslation("marketing");
  const { pathname } = useLocation();
  const { isAuthenticated, isPending } = useAuth();

  const nav = [
    { to: "/", label: t("nav.home") },
    { to: "/docs", label: t("nav.docs") },
    { to: "/blog", label: t("nav.blog") },
  ];

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <TabdoLogo />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                  (n.to === "/" ? pathname === "/" : pathname === n.to || pathname.startsWith(n.to + "/")) && "bg-accent font-medium text-foreground"
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {!isPending && isAuthenticated ? (
              <Button asChild size="sm">
                <Link to="/app">{t("enterWorkspace")}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">{t("login")}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">{t("signup")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-border bg-muted py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <TabdoLogo markClassName="h-7 w-7" className="font-medium" />
            <p className="text-xs">
              <a href={BRAND.url} className="hover:text-foreground">{BRAND.domain}</a>
              <span className="mx-1.5" aria-hidden>·</span>
              <span>{BRAND.alternateDomain}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-end">
            <Link to="/docs" className="hover:text-foreground">{t("nav.docs")}</Link>
            <Link to="/blog" className="hover:text-foreground">{t("nav.blog")}</Link>
            <p>{t("brand.category")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
