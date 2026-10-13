import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Keyboard, Moon, Sun, Monitor } from "lucide-react";
import { useAppShell } from "@/context/AppShellContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type Theme } from "@/components/theme/theme-provider";

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

export function SettingsPage() {
  const { sidebarCollapsed, setSidebarCollapsed, aiOpen, setAiOpen } = useAppShell();
  const { theme, setTheme } = useTheme();
  return <AppPage className="gap-4" header={<AppPageHeader page="settings" description="工作区外观与布局偏好" />}>
    <Card className="shrink-0">
      <CardHeader><CardTitle>外观</CardTitle></CardHeader>
      <CardContent>
        <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(value) => { if (value) setTheme(value as Theme); }} aria-label="工作区外观" className="flex-wrap justify-start gap-2">
          {THEME_OPTIONS.map(({ id, label, icon: Icon }) => <ToggleGroupItem key={id} value={id} aria-label={label}><Icon aria-hidden />{label}</ToggleGroupItem>)}
        </ToggleGroup>
      </CardContent>
    </Card>
    <Card className="shrink-0">
      <CardHeader><CardTitle>布局</CardTitle></CardHeader>
      <CardContent><FieldGroup>
        <Field orientation="horizontal"><FieldLabel htmlFor="settings-sidebar">收起左侧导航</FieldLabel><Switch id="settings-sidebar" aria-label="收起左侧导航" checked={sidebarCollapsed} onCheckedChange={setSidebarCollapsed} /></Field>
        <Field orientation="horizontal"><FieldLabel htmlFor="settings-ai">默认打开 AI 助手抽屉</FieldLabel><Switch id="settings-ai" aria-label="默认打开 AI 助手抽屉" checked={aiOpen} onCheckedChange={setAiOpen} /></Field>
      </FieldGroup></CardContent>
    </Card>
    <Card className="shrink-0">
      <CardHeader><CardTitle className="flex items-center gap-2"><Keyboard aria-hidden className="size-4" />快捷键</CardTitle></CardHeader>
      <CardContent><ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex justify-between gap-3"><span>收起 / 展开侧栏</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">⌘ \\</kbd></li>
        <li className="flex justify-between gap-3"><span>打开 / 关闭 AI</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">⌘ J</kbd></li>
      </ul></CardContent>
    </Card>
  </AppPage>;
}
