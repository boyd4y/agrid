import { Keyboard, Moon, Sun, Monitor } from "lucide-react";
import { useAppShell } from "@/context/AppShellContext";
import { Button } from "@/components/ui/button";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

export function SettingsPage() {
  const { sidebarCollapsed, setSidebarCollapsed, aiOpen, setAiOpen } =
    useAppShell();
  const { theme, setTheme } = useTheme();

  return (
    <div className="mx-auto h-full min-h-0 max-w-2xl overflow-auto px-6 py-10 md:px-10">
      <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        工作区偏好 · shadcn 语义主题
      </p>

      <section className="mt-8 space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">外观</h2>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTheme(id)}
              className={cn(
                "gap-1.5",
                theme === id && "border-primary bg-accent ring-1 ring-ring"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-4 space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">布局</h2>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>收起左侧导航</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? "已收起" : "已展开"}
          </Button>
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>默认打开 AI 助手抽屉</span>
          <Button variant="outline" size="sm" onClick={() => setAiOpen(!aiOpen)}>
            {aiOpen ? "打开" : "关闭"}
          </Button>
        </label>
      </section>

      <section className="mt-4 space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Keyboard className="h-4 w-4" />
          快捷键
        </h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex justify-between">
            <span>收起 / 展开侧栏</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">
              ⌘ \\
            </kbd>
          </li>
          <li className="flex justify-between">
            <span>打开 / 关闭 AI</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">
              ⌘ J
            </kbd>
          </li>
        </ul>
      </section>
    </div>
  );
}
