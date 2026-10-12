import { Link, Outlet } from "react-router-dom";
import { AgridLogo } from "@/components/brand/AgridLogo";
import { AuthSideArt } from "@/components/illustrations";

export function AuthLayout() {
  return (
    <div className="flex min-h-full bg-background text-foreground">
      {/* Illustrated side panel — Notion marketing feel */}
      <aside className="relative hidden w-[46%] overflow-hidden lg:block">
        <AuthSideArt className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-muted/90 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-10">
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            一张表，人和 Agent 一起写
          </p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            软纸质感、轻插画、命令层对齐——登录后直接进入 Notion 气质的工作台。
          </p>
        </div>
      </aside>

      {/* Form column */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-12">
        {/* Soft doodle wash on mobile / form side */}
        <div
          className="pointer-events-none absolute inset-0 -z-10 lg:hidden"
          style={{
            background:
              "radial-gradient(ellipse 70% 50% at 20% 10%, #F1E3B7 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 90% 80%, #D3E5EF 0%, transparent 50%)",
          }}
        />
        <Link to="/" className="inline-flex items-center gap-2">
            <AgridLogo />
          </Link>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-background/95 p-7 shadow-[0_8px_30px_rgba(55,53,47,0.06)] backdrop-blur">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
