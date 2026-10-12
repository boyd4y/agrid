import { Link, Outlet, useLocation } from "react-router-dom";
import { AgridLogo } from "@/components/brand/AgridLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function MarketingLayout() {
  const { pathname } = useLocation();
  const { isAuthenticated, isPending } = useAuth();

  const nav = [
    { to: "/", label: "首页" },
    { to: "/docs", label: "文档" },
    { to: "/blog", label: "博客" },
  ];

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <AgridLogo />
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
                <Link to="/app">进入工作台</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">登录</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">注册</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-border bg-muted py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
          <AgridLogo markClassName="h-7 w-7" className="font-medium" />
          <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-end">
            <Link to="/docs" className="hover:text-foreground">文档</Link>
            <Link to="/blog" className="hover:text-foreground">博客</Link>
            <p>Notion 风格多维表 · 人机同权命令层</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
