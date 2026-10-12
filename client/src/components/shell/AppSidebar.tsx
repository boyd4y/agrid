import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  NiChevronLeft,
  NiChevronRight,
  NiHome,
  NiGrid,
  NiLogout,
  NiPlus,
  NiSettings,
  NiSparkles,
  NiTable,
  NiUsers,
  NiZap,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppShell } from "@/context/AppShellContext";
import { useAuth } from "@/hooks/useAuth";
import { authClient } from "@/lib/auth-client";
import type { TableMeta } from "@/types/table";
import { AgridLogo } from "@/components/brand/AgridLogo";

type Props = {
  tables: TableMeta[];
  onCreateTable: () => void;
  tablesLoading?: boolean;
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
  /** Extra path prefix that should keep this item active */
  activeMatch?: (pathname: string) => boolean;
}) {
  const location = useLocation();
  const inner = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
  const base =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors";

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
 * Lower: 成员 · 智能体 · 设置 (+ user)
 * No left AI entry — chat lives in workspace split / ⌘J drawer only.
 */
export function AppSidebar({ tables, onCreateTable, tablesLoading }: Props) {
  const { sidebarCollapsed, toggleSidebar, activeTableId } = useAppShell();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-muted transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-[56px]" : "w-[240px]"
      )}
      data-testid="app-sidebar"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-border px-3",
          sidebarCollapsed && "justify-center px-2"
        )}
      >
        <Link to="/app" className="flex min-w-0 items-center gap-2.5" title="Agrid">
          <AgridLogo
            showWordmark={false}
            markClassName="h-8 w-8 rounded-[10px] shadow-[0_4px_12px_rgba(55,53,47,0.06)]"
          />
          {!sidebarCollapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                Agrid
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                Workspace
              </div>
            </div>
          )}
        </Link>
        {!sidebarCollapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-muted-foreground"
            onClick={toggleSidebar}
            title="收起侧栏 ⌘\\"
          >
            <NiChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ========== UPPER ZONE ========== */}
      <nav
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2"
        data-testid="sidebar-upper"
      >
        <div className="space-y-0.5">
          {!sidebarCollapsed && (
            <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              工作区
            </div>
          )}
          <NavItem
            to="/app"
            end
            icon={NiHome}
            label="对话建系统"
            collapsed={sidebarCollapsed}
          />
          <NavItem
            to="/app/tables"
            icon={NiGrid}
            label="表格"
            collapsed={sidebarCollapsed}
            activeMatch={(pathname) =>
              pathname === "/app/tables" ||
              (/^\/app\/tables\/[^/]+$/.test(pathname))
            }
          />
          <NavItem
            to="/app/automations"
            icon={NiZap}
            label="自动化"
            collapsed={sidebarCollapsed}
            titleHint="按表格配置当 / 如果 / 就规则"
            activeMatch={(pathname) => pathname.includes("/automations")}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!sidebarCollapsed && (
            <div className="mb-1 flex items-center justify-between px-2.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                我的表格
              </span>
              <button
                type="button"
                onClick={onCreateTable}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="新建表格"
              >
                <NiPlus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <ul className="max-h-full space-y-0.5 overflow-y-auto">
            {tablesLoading && !sidebarCollapsed && (
              <li className="px-2.5 py-1 text-xs text-muted-foreground">加载中…</li>
            )}
            {tables.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  title={t.name}
                  onClick={() => navigate(`/app/tables/${t.id}`)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                    sidebarCollapsed && "justify-center px-2",
                    activeTableId === t.id || location.pathname.includes(t.id)
                      ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <NiTable className="h-3.5 w-3.5 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{t.name}</span>}
                </button>
              </li>
            ))}
            {!tablesLoading && tables.length === 0 && !sidebarCollapsed && (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">还没有表格</li>
            )}
          </ul>
        </div>
      </nav>

      {/* ========== LOWER ZONE ========== */}
      <div
        className="shrink-0 border-t border-border p-2"
        data-testid="sidebar-lower"
      >
        <div className="mb-1 space-y-0.5">
          {!sidebarCollapsed && (
            <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              组织
            </div>
          )}
          <NavItem
            to="/app/members"
            icon={NiUsers}
            label="成员"
            collapsed={sidebarCollapsed}
            titleHint="员工（人类成员）"
          />
          <NavItem
            to="/app/agents"
            icon={NiSparkles}
            label="智能体"
            collapsed={sidebarCollapsed}
            titleHint="Agent（与人对齐权限）"
          />
          <NavItem
            to="/app/settings"
            icon={NiSettings}
            label="设置"
            collapsed={sidebarCollapsed}
          />
        </div>

        {sidebarCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="mx-auto mb-1 flex h-7 w-7"
            onClick={toggleSidebar}
            title="展开侧栏"
          >
            <NiChevronRight className="h-4 w-4" />
          </Button>
        ) : null}

        {user && (
          <div
            className={cn(
              "mt-1 flex items-center gap-2 rounded-md px-2 py-1.5",
              sidebarCollapsed && "justify-center px-0"
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F1E3B7] text-[11px] font-semibold text-foreground">
              {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
            </span>
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {user.name || "用户"}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {user.email}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  title="退出"
                  onClick={async () => {
                    await authClient.signOut();
                    window.location.href = "/";
                  }}
                >
                  <NiLogout className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
