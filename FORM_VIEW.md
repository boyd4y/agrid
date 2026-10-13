# Form View — tabdo

> Status: **v2 Typeform implemented** — themes (5 presets), classic/focus layout, DnD field order, question inspector, on-demand views (no fixed 3 tabs).  
> Goal: Feishu-like **表单模式** on the **same dataset** as Grid / Board; UI on **shadcn Form**; Agent can design forms via the shared command layer.

## 1. Goal

1. One product table (`tables` + `columns` + `rows.cells` JSONB) exposes **multiple views**: Grid, Board (kanban), and **Form**.
2. Form is a **view over the same columns / rows** — not a separate store. Submit = `addRow` / `updateCells` on that table.
3. Humans fill forms; Agents **design** form layout (field order, visibility, required, labels, sections) without DDL.
4. Field widgets reuse the same column types and shadcn editors as the grid (no native `<select>` / `type=date`).
5. **v2 UX**: Typeform-inspired presentation (themes + conversational layout), builder with drag-drop reorder, and per-question settings — still same dataset.

## 2. Decisions (locked / proposed)

| Topic | Choice |
|---|---|
| Data source | **Same table** as Grid/Board (`organization_id` scoped) |
| Storage model | Scheme 2 unchanged — form config is **view metadata**, not new cell storage |
| Form UI kit | **shadcn Form** (`react-hook-form` + Zod) + existing cell editors |
| View switch | Table page: Grid \| Board \| **Form** (and optional public `/f/:formId` later) |
| Agent role | Design + open preview slot; humans (or share link) submit |
| Formula columns | **Read-only** on form (computed after save / display-only on edit) |
| Multi-tenant | Same as `MULTI_TENANT.md` — all form defs filtered by org via table FK |
| Presentation (v2) | Typeform-like **themes** + layout modes (card / one-at-a-time); not a Typeform clone |
| Builder (v2) | **Drag-drop** field order + right inspector for **question-type settings** |

## 3. Non-goals

### v1 (done / still out)
- Separate form-only database or duplicated field types.
- Arbitrary HTML / custom JS form builders.
- Payment / file upload / branching logic (later).
- Breaking Grid/Board; Form is additive.

### v2 Typeform plan (explicitly out of first Typeform pass)
- Full Typeform question catalog (video, payment, ranking, matrix, etc.).
- Brand Kit org-wide theme sharing (can come after preset gallery).
- Logic jumps / scoring / endings A-B (note as later).
- Building a second widget set outside shadcn + column types.

---

## 4. Typeform UX research (brief)

Source of truth: Typeform product + Help Center (themes, multi-question pages, builder).

### 4.1 What Typeform does well

| Pattern | Behavior | Why it feels good |
|---|---|---|
| **Conversational default** | Historically **one question per page**; optional multi-question page | Focus, less wall-of-fields fatigue |
| **Block builder** | Questions are blocks; click to edit; live preview | Design = fill experience |
| **Drag-and-drop** | Reorder questions; drag into/out of multi-question pages | Order is first-class UX |
| **Themes** | Gallery + custom: colors (question / answer / button / button text / background), font, corner radius, optional bg image + logo | Brand without coding |
| **Per-question settings** | Right sidebar: required, limits, placeholders, type-specific options | Settings live next to the selected block |
| **Welcome / Ending** | Chrome screens around the questions | Narrative, not just a CRUD form |

### 4.2 What we take vs skip

| Take for tabdo | Skip / defer |
|---|---|
| Preset **themes** (gallery) + form-level theme tokens | Premium gallery / Brand Kit sync |
| **Layout modes**: `classic` (stacked card) vs `focus` (one question at a time) | Full multi-page “form page” group model in v2.0 — start with flat ordered list + optional sections |
| **Drag-drop reorder** of fields in design mode | Drag to create new DB columns (columns still created via table/agent cmds) |
| **Question inspector**: label, help, required, placeholder, type-specific | Logic jumps, hidden fields by answer, payment |
| Live **fill preview** beside or via UI slot | Pixel-perfect Typeform chrome |

### 4.3 Mapping to our model

- Typeform “question” ↔ tabdo **column** + `FormFieldConfig` overlay.
- Typeform “theme” ↔ `FormViewConfig.theme` (preset id + optional token overrides).
- Typeform “Design panel” ↔ Form design mode: canvas (preview) + field list (sortable) + inspector.
- Answers still land in `rows.cells` — themes never fork storage.

---

## 5. Mental model (Feishu data + Typeform presentation)

```
Dataset (one table)
  ├── columns[]          ← field schema (shared; type source of truth)
  ├── rows[]             ← records (shared)
  └── views[]
        ├── grid
        ├── board
        └── form
              ├── fields[]     ← order + labels + required + per-question settings
              ├── sections?    ← optional grouping
              ├── layout       ← classic | focus
              └── theme        ← preset + token overrides
```

- **Design mode**: drag fields, edit question settings, pick theme/layout; Agent can do the same via commands.
- **Fill mode**: themed UI; submit → `addRow` / `updateCells`.
- Preview UI Slot: `open_preview` `{ kind: "form", … }` still on-demand.

---

## 6. Data model (current + v2 extensions)

### 6.1 `table_views` (already)

| Column | Notes |
|---|---|
| `id` | PK |
| `table_id` | FK → `tables` |
| `type` | `grid` \| `board` \| `form` |
| `name` | e.g. 「表单」 |
| `config` | JSONB — view-specific |
| `sort_order`, `created_at`, `updated_at` | |

### 6.2 Form `config` — current

```ts
type FormViewConfig = {
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  mode?: "create" | "edit";
  fields: FormFieldConfig[];
  sections?: { id: string; title: string; fieldIds: string[] }[];
};

type FormFieldConfig = {
  columnId: string;
  label?: string;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
};
```

### 6.3 Form `config` — planned Typeform extensions (additive)

```ts
type FormLayoutMode = "classic" | "focus";
// classic = stacked card (current feel, but themed)
// focus   = Typeform-like one question at a time + progress

type FormThemePresetId =
  | "notion-light"   // cream / charcoal — default, matches tabdo N1
  | "ink"            // high-contrast dark text on soft white
  | "ocean"          // cool blue accents
  | "sunset"         // warm coral / amber accents
  | "midnight";      // dark background, light type

type FormThemeTokens = {
  background?: string;      // page / card bg
  question?: string;        // title + labels
  answer?: string;          // input text / choice text
  button?: string;          // primary CTA bg
  buttonText?: string;
  accent?: string;          // focus ring / progress
  radius?: "sm" | "md" | "lg";  // Typeform-style corner radius
  font?: "sans" | "serif";      // map to existing CSS vars / Tailwind families
};

type FormViewConfigV2 = FormViewConfig & {
  layout?: FormLayoutMode;           // default "classic"
  theme?: {
    preset: FormThemePresetId;       // required when theme set
    overrides?: FormThemeTokens;     // optional fine-tune
  };
  welcome?: { title?: string; description?: string; ctaLabel?: string };
  ending?: { title?: string; description?: string }; // mirrors successMessage; prefer one later
  /** Per-question extras beyond current FormFieldConfig */
  // see FormFieldConfigV2
};

type FormFieldConfigV2 = FormFieldConfig & {
  /** Type-specific settings (never invent a new column type here) */
  settings?: FormQuestionSettings;
};

/** Discriminated by column.type at apply time */
type FormQuestionSettings =
  | { kind: "text"; multiline?: boolean; maxLength?: number; inputMode?: "text" | "email" | "url" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "select"; display?: "dropdown" | "buttons" }      // buttons ≈ Typeform multiple choice chips
  | { kind: "multi_select"; display?: "checkbox" | "buttons"; minItems?: number; maxItems?: number }
  | { kind: "date"; includeTime?: boolean }                   // includeTime deferred if grid lacks it
  | { kind: "checkbox"; agreeLabel?: string }                 // single boolean framed as agree
  | { kind: "person"; multiple?: boolean }                    // multiple only if column supports
  | { kind: "formula" };                                      // no write settings
```

**Rules:**

- `column.type` + `column.config.options` remain source of truth for options / base type.
- `settings` only overlays presentation + soft validation; server still validates against column + `required`.
- Changing `settings.display` does **not** migrate cell data.

---

## 7. Field types — map to shadcn Form (unchanged core)

| Column type | Form control (shadcn) | v2 settings hooks |
|---|---|---|
| `text` | Input / Textarea | multiline, maxLength, email/url |
| `number` | numeric Input | min, max, step |
| `select` | Popover soft tags **or** button group | `display: dropdown \| buttons` |
| `multi_select` | Popover + checks **or** button group | display + min/max items |
| `date` | DatePicker | includeTime later |
| `checkbox` | Checkbox | agreeLabel |
| `person` | member Popover | multiple later |
| `formula` | read-only | none |

---

## 8. UI surfaces — design / fill / preview

### 8.1 Table page Form tab (v2 layout)

```
┌─ Form toolbar ─────────────────────────────────────────┐
│  Layout: Classic | Focus    Theme: [preset ▾]    Preview│
├──────────────┬─────────────────────────┬───────────────┤
│ Field list   │ Canvas (live fill look) │ Inspector     │
│ (drag handle │ themed, classic/focus)  │ selected Q    │
│  reorder)    │                         │ settings      │
└──────────────┴─────────────────────────┴───────────────┘
```

- **Left**: sortable field list (dnd-kit or shadcn-compatible DnD); show type icon + label; hide/show toggle.
- **Center**: themed preview (same component as fill mode); selecting a block focuses inspector.
- **Right**: question-type settings (see §10).
- **Toolbar**: layout mode, theme preset, optional welcome/ending copy.

### 8.2 Fill mode

- Apply CSS variables from `theme.preset` + overrides (map onto `--tabdo-*` / local form tokens).
- `classic`: single scrollable card (current structure, restyled).
- `focus`: one visible field + Next / OK + progress; keyboard Enter advances when valid.
- Submit still shared command path.

### 8.3 Talk-to-Build slot

- Unchanged: on-demand plugin; full height; theme respected when Agent opens form preview.

---

## 9. Themes plan (Typeform-like, tabdo-branded)

### 9.1 Presets (ship 5)

| Id | Feel | Tokens sketch |
|---|---|---|
| `notion-light` | Default; cream bg, charcoal questions, soft blue accent | Matches N1 logo world |
| `ink` | Editorial; white bg, near-black type, black button | Minimal |
| `ocean` | Cool; pale blue bg, navy questions, blue button | Product-y |
| `sunset` | Warm; cream bg, coral accent/button | Friendly survey |
| `midnight` | Dark; deep bg, light questions, bright accent | Night fill |

### 9.2 Theme application

- Presets are **code constants** (v2.0); no DB theme table yet.
- `config.theme.overrides` optional hex / radius / font for Agent or power users.
- Corner radius applies to inputs + primary button (Typeform pattern).
- Background image / logo: **defer** (v2.1); tokens only first.

### 9.3 Agent

- `updateFormView` / new `setFormTheme` accept `{ preset, overrides? }`.
- `setFormLayout` → `classic` | `focus`.

---

## 10. Drag-drop field order

### 10.1 Behavior

- Design mode only; fill mode never reorders.
- Drag handle on each field row (and optionally on canvas blocks).
- Drop updates local order → persist via `reorderFormFields` (existing cmd) or `setFormFields` full replace.
- Sections (if present): drag within section; dragging across sections updates `sections.fieldIds` + flat `fields` order (keep one canonical `fields[]` order; sections reference ids).

### 10.2 Tech sketch (when implementing)

- `@dnd-kit/core` + sortable (or existing project DnD if any) — **plan only here**.
- Optimistic UI; revert on API error.
- Agent: `reorderFormFields({ viewId, columnIds: string[] })` remains the source of truth.

### 10.3 Constraints

- Cannot drag a field that isn’t on the table; “Add field” = pick existing column or run `addColumn` then append.
- Formula fields: draggable for display order but stay readOnly / hidden on create by default.

---

## 11. Question-type settings (inspector)

### 11.1 Common (all writable types)

- Label (override)
- Help text
- Placeholder (where meaningful)
- Required
- Hidden / Read-only

### 11.2 Type-specific (see `FormQuestionSettings`)

| Type | Settings UI |
|---|---|
| text | Multiline toggle; max length; inputMode text/email/url |
| number | Min / max / step |
| select | Display: 下拉 vs 按钮组; options edit → still `updateColumn` on shared options |
| multi_select | Display; min/max selections |
| date | Date only (time later) |
| checkbox | Custom agree label |
| person | Single (multiple later) |
| formula | “Computed — not submitted” callout |

### 11.3 Editing options

- Changing select/multi options edits **column.config** (shared with Grid/Board) — warn in UI: “选项与表格视图共用”.
- Prefer deep-link / inline “编辑选项” → existing column editor, not a fork.

### 11.4 Agent

| Command | Purpose |
|---|---|
| `setFormFieldSettings` | Patch one field’s label/required/settings |
| `reorderFormFields` | Already planned / present — used by DnD |
| `setFormTheme` | preset + overrides |
| `setFormLayout` | classic \| focus |
| `setFormChrome` | welcome / ending / submit / success copy |

---

## 12. Agent design flow (v2)

Example: “把需求表做成 Typeform 风格，一题一页，用 sunset 主题”

1. `getView` / ensure form view exists  
2. `setFormLayout` → `focus`  
3. `setFormTheme` → `sunset`  
4. `setFormFields` / `setFormFieldSettings` (labels, required, button display for selects)  
5. `reorderFormFields` if needed  
6. `open_preview` form slot for human try  

---

## 13. Validation & permissions (unchanged principles)

- Zod from `required` + column type + `settings` soft limits (maxLength, min/max).
- Server re-validates; ignore unknown keys; reject formula writes.
- Design = table admin/write; fill = table write (public link later).

---

## 14. Rollout

### Done (v1)
1. `table_views` + form config; seed demo form.  
2. shadcn `TableForm` + Form tab.  
3. Agent tools + `open_preview` form kind.

### Done (v2 Typeform pass)
1. Extend `FormViewConfig` with `layout`, `theme`, richer `fields[].settings`.  
2. Theme preset CSS tokens + apply in fill/design canvas.  
3. Design shell: field list DnD + inspector + themed canvas.  
4. `focus` layout (one-at-a-time) + progress.  
5. Agent: `setFormTheme` / `setFormLayout` / `setFormFieldSettings`.  
6. Polish: welcome/ending; select `buttons` display; screenshot QA vs current “ugly” stacked form.

### Later
- Background image / logo; org Brand Kit.  
- Branching logic; multi-question page groups.  
- Public `/f/:viewId`.  
- Attachment / rating question types (new column types first).

---

## 15. Open questions

- Default layout for new forms: keep `classic` for Feishu parity, or `focus` for Typeform wow? (**Suggest:** `classic` default, Agent/templates can set `focus`.)  
- Theme overrides: free hex now, or presets-only until Brand Kit? (**Suggest:** presets + limited overrides.)  
- Select `buttons` display: share cell editor or form-only widget? (**Suggest:** form-only variant first, same option ids.)  
- Should welcome/ending replace `title`/`successMessage` or sit beside them?

---

**Summary:** Keep Feishu **same-dataset** form view; Typeform **themes + focus layout + DnD builder + per-question settings** on `table_views.config`; views are **on-demand** (not fixed Grid|Board|Form tabs).
