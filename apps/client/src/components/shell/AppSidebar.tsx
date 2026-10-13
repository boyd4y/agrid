import { useEffect, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { TableIcon } from "@/components/table/TableIcon";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  NiChevronLeft,
  NiChevronRight,
  NiLogout,
  NiPlus,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppShell } from "@/context/AppShellContext";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { useAuth } from "@/hooks/useAuth";
import { authClient } from "@/lib/auth-client";
import type { TableMeta } from "@/types/table";
import { TabdoLogo } from "@/components/brand/TabdoLogo";
import { BRAND } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useTranslation } from "react-i18next";
import { APP_NAVIGATION } from "./app-navigation";
import { SIDEBAR_ICON, SIDEBAR_ROW } from "./sidebar-styles";

type Props = {
  tables: TableMeta[];
  onCreateTable: () => void;
  tablesLoading?: boolean;
  onTogglePin: (table: TableMeta) => Promise<void>;
};

function NavItem({
  to,
  end,
  icon: Icon,
  label,
  collapsed,
  onClick,
  titleHint,
  activeMatch,
}: {
  to?: string;
  end?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
  titleHint?: string;
  activeMatch?: (pathname: string) => boolean;
}) {
  const location = useLocation();
  const inner = (
    <>
      <Icon className={SIDEBAR_ICON} />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
  const base = cn(SIDEBAR_ROW, "w-full");

  if (onClick && !to) {
    return (
      <button
        type="button"
        title={titleHint ?? (collapsed ? label : undefined)}
        onClick={onClick}
        className={cn(
          base,
          "text-foreground hover:bg-accent",
          collapsed && "justify-center px-2"
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <NavLink
      to={to!}
      end={end}
      title={titleHint ?? (collapsed ? label : undefined)}
      className={({ isActive }) => {
        const active = activeMatch
          ? activeMatch(location.pathname)
          : isActive;
        return cn(
          base,
          collapsed && "justify-center px-2",
          active
            ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        );
      }}
    >
      {inner}
    </NavLink>
  );
}

/**
 * Upper: workspace / tables / table list
 * Lower: members · agents · settings (+ user)
 * Menu names and icons match their page headers through APP_NAVIGATION.
 */
export function AppSidebar({ tables, onCreateTable, tablesLoading, onTogglePin }: Props) {
  const { t } = useTranslation(["app", "common", "errors"]);
  const { sidebarCollapsed, toggleSidebar } = useAppShell();
  const { user, refetch } = useAuth();
  useEffect(() => {
    const update = () => void refetch();
    window.addEventListener("tabdo:agents-changed", update);
    return () => window.removeEventListener("tabdo:agents-changed", update);
  }, [refetch]);
  const [tablesExpanded, setTablesExpanded] = useState(false);
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? t("common:modKey") : t("common:modKeyCtrl");

  const nav = (key: keyof typeof APP_NAVIGATION) => {
    const item = APP_NAVIGATION[key];
    return { to: item.to, icon: item.icon, label: t(item.labelKey) };
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-muted transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-[56px]" : "w-[240px]"
      )}
      data-testid="app-sidebar"
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-border px-3",
          sidebarCollapsed && "justify-center px-2"
        )}
      >
        <Link to="/app" className="flex min-w-0 items-center gap-2.5" title={BRAND.name}>
          <TabdoLogo
            showWordmark={false}
            markClassName="h-8 w-8"
          />
          {!sidebarCollapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                {BRAND.name}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {t("shell.workspace")}
              </div>
            </div>
          )}
        </Link>
        {!sidebarCollapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            onClick={toggleSidebar}
            title={t("shell.collapseSidebarHint", { mod })}
            aria-label={t("shell.collapseSidebar")}
          >
            <NiChevronLeft />
          </Button>
        )}
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2"
        data-testid="sidebar-upper"
      >
        <div className="flex flex-col gap-0.5">
          {!sidebarCollapsed && (
            <div className="px-2.5 pb-1 text-[10px] font-medium text-muted-foreground">
              {t("shell.workspace")}
            </div>
          )}
          <NavItem
            {...nav("ai")}
            end
            collapsed={sidebarCollapsed}
          />
          <NavItem
            {...nav("tables")}
            collapsed={sidebarCollapsed}
            activeMatch={(pathname) =>
              pathname === "/app/tables" ||
              (/^\/app\/tables\/[^/]+$/.test(pathname))
            }
          />
          <NavItem
            {...nav("automations")}
            collapsed={sidebarCollapsed}
            titleHint={t("shell.automationsHint")}
            activeMatch={(pathname) => pathname.includes("/automations")}
          />
          <NavItem {...nav("reports")} collapsed={sidebarCollapsed} />
          {tables.filter((table) => table.pinned).map((table) => <SidebarTable key={table.id} table={table} collapsed={sidebarCollapsed} onTogglePin={onTogglePin} />)}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!sidebarCollapsed && (
            <div className="mb-1 flex items-center justify-between px-2.5">
              <button type="button" onClick={() => setTablesExpanded((expanded) => !expanded)} aria-expanded={tablesExpanded} aria-controls="sidebar-my-tables" className="flex items-center gap-1 rounded py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                <NiChevronRight className={cn("size-3 transition-transform", tablesExpanded && "rotate-90")} />{t("shell.myTables")}
              </button>
              <button
                type="button"
                onClick={onCreateTable}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t("shell.newTable")}
              >
                <NiPlus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <ul id="sidebar-my-tables" hidden={!tablesExpanded || sidebarCollapsed} className={cn("min-h-0 flex-col gap-0.5 overflow-y-auto", !tablesExpanded || sidebarCollapsed ? "hidden" : "flex")}>
            {tablesLoading && <li className="px-2.5 py-1 text-xs text-muted-foreground">{t("common:loading")}</li>}
            {tables.filter((table) => !table.pinned).map((table) => <li key={table.id}><SidebarTable table={table} collapsed={false} onTogglePin={onTogglePin} /></li>)}
            {!tablesLoading && !tables.some((table) => !table.pinned) && <li className="px-2.5 py-2 text-xs text-muted-foreground">{tables.length ? t("shell.tablesPinned") : t("shell.noTables")}</li>}
          </ul>
        </div>
      </nav>

      <div
        className="shrink-0 border-t border-border p-2"
        data-testid="sidebar-lower"
      >
        <div className="mb-1 flex flex-col gap-0.5">
          {!sidebarCollapsed && (
            <div className="px-2.5 pb-1 text-[10px] font-medium text-muted-foreground">
              {t("shell.organization")}
            </div>
          )}
          <NavItem
            {...nav("members")}
            collapsed={sidebarCollapsed}
            titleHint={t("shell.membersHint")}
          />
          <NavItem
            {...nav("agents")}
            collapsed={sidebarCollapsed}
            titleHint={t("shell.agentsHint")}
          />
          <NavItem
            {...nav("settings")}
            collapsed={sidebarCollapsed}
          />
          <NavItem {...nav("skills")} collapsed={sidebarCollapsed} />
          <ThemeToggle sidebar expanded={!sidebarCollapsed} />
        </div>

        {sidebarCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="mx-auto mb-1 flex size-7"
            onClick={toggleSidebar}
            title={t("shell.expandSidebar")}
            aria-label={t("shell.expandSidebar")}
          >
            <NiChevronRight />
          </Button>
        ) : null}

        {user && (
          <div
            className={cn(
              "mt-1 flex items-center gap-2 rounded-md px-2 py-1.5",
              sidebarCollapsed && "justify-center px-0"
            )}
          >
            <MemberAvatar name={user.name || user.email || t("common:user")} image={user.image} kind={user.kind} className="size-7" />
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {user.name || t("common:user")}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {user.email}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title={t("shell.signOut")}
                  aria-label={t("shell.signOutAria")}
                  onClick={async () => {
                    await authClient.signOut();
                    window.location.href = "/";
                  }}
                >
                  <NiLogout />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarTable({ table, collapsed, onTogglePin }: { table: TableMeta; collapsed: boolean; onTogglePin: (table: TableMeta) => Promise<void> }) {
  const { t } = useTranslation(["app", "errors"]);
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div>
    <div className="group relative">
      <Link to={`/app/tables/${table.id}`} title={table.name} data-testid={`sidebar-table-${table.id}`} className={cn(SIDEBAR_ROW, "w-full", collapsed ? "justify-center px-2" : "pr-9", location.pathname.includes(table.id) ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
        <TableIcon name={table.icon} className={SIDEBAR_ICON} />{!collapsed && <span className="truncate">{table.name}</span>}
      </Link>
      {!collapsed && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" disabled={busy} title={table.pinned ? t("shell.unpinFromWorkspace") : t("shell.pinToWorkspace")} aria-label={`${table.pinned ? t("shell.unpin") : t("shell.pin")}${table.name}`} onClick={async () => {
        setBusy(true); setError(null);
        try { await onTogglePin(table); }
        catch (error) { setError(error instanceof Error ? error.message : t("errors:pinFailed")); }
        finally { setBusy(false); }
      }}>{table.pinned ? <PinOff /> : <Pin />}</Button>}
    </div>
    {error && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}
  </div>;
}
