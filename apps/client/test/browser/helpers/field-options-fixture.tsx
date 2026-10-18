import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CellEditor } from "@/components/table/CellEditors";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import { formThemeStyle } from "@/components/form/formThemes";
import type { CellValue, ColumnDef } from "@/types/table";
import type { MemberOption } from "@/lib/api";
import i18n from "@/i18n";
import "@/index.css";

const params = new URLSearchParams(location.search);
await i18n.changeLanguage(params.get("lang") ?? "en");
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const cell = params.get("host") === "cell";
const type = params.get("type") as "select" | "multi_select" | "person";
const typeform = params.get("variant") === "typeform";
const empty = params.has("empty");
const column: ColumnDef = {
  id: "field", tableId: "fixture", name: type, type, width: 280, sortOrder: 0, createdAt: "",
  config: { options: empty ? [] : Array.from({ length: 40 }, (_, index) => ({
    id: `stable-${index}`, label: `${i18n.language === "en" ? "Option" : "选项"} ${String(index).padStart(2, "0")}`,
  })) },
};
const members: MemberOption[] = empty ? [] : [
  { id: "membership-1", userId: "user-ada", name: "Ada", email: "ada@example.test", kind: "human", role: "member" },
  { id: "membership-2", userId: "user-agent", name: "Agent", email: "assistant@example.test", kind: "agent", role: "member" },
];

function Fixture() {
  const [value, setValue] = useState<CellValue>(params.has("blank") ? null : type === "multi_select" ? ["stable-0"] : type === "person" ? "Ada" : "stable-0");
  const [events, setEvents] = useState<{ kind: string; value?: CellValue }[]>([]);
  const [editing, setEditing] = useState(true);
  const append = (kind: string, next?: CellValue) => setEvents((prev) => [...prev, { kind, value: next }]);
  return (
    <main className="min-h-full bg-background p-8 text-foreground">
      <button type="button" data-testid="outside">Outside</button>
      <div className="mt-8 w-80" data-testid="host" style={typeform ? formThemeStyle({ preset: "ocean" }) : undefined}>
        {cell ? editing && (
          <div className="h-9">
            <CellEditor column={column} value={value} members={members}
              onCommit={(next) => { append("commit", next); setValue(next); setEditing(false); }}
              onCancel={() => { append("cancel"); setEditing(false); }} />
          </div>
        ) : (
          <FormFieldControl column={column} value={value} members={members}
            variant={typeform ? "typeform" : "default"}
            settings={params.has("buttons") && type !== "person" ? { kind: type, display: "buttons" } : undefined}
            onChange={(next) => { append("change", next); setValue(next); }} />
        )}
      </div>
      <output data-testid="value">{JSON.stringify(value)}</output>
      <output data-testid="events">{JSON.stringify(events)}</output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
