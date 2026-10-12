# Theme rebuild review (Impeccable + shadcn)

## What changed
- Installed **Impeccable** (`npx impeccable install --providers=grok`) and wrote `PRODUCT.md` / `DESIGN.md` governance.
- Rebuilt `index.css` with shadcn-style runtime tokens mapped via `@theme inline` → `bg-background`, `text-foreground`, `border-border`, `muted`, `accent`, `popover`, `card`, `primary`, `ring`.
- Added `ThemeProvider` + FOUC script; Settings → 外观 (浅色 / 深色 / 跟随系统).
- Rewrote UI primitives (button, input, select, popover, calendar, checkbox, switch, textarea, card, badge) to semantic classes.
- Bulk-replaced `bg-white` / `slate-*` / `--notion-*` chrome classes across app surfaces (~33 files).
- DatePicker / Calendar use `bg-popover` + selected day `bg-foreground text-background` (readable light & dark).

## Screenshots
`screenshots/theme/{light,dark}-{home,workspace,table,filter,datepicker,settings,select-pop}.png`

## Review (PM + design)
| Area | Light | Dark | Notes |
|------|-------|------|-------|
| Marketing / home | OK | OK | Semantic surfaces |
| Workspace shell | OK | OK | Sidebar `muted`, active `card` |
| Table grid | OK | OK | Header `muted`, cells `background` |
| Filter bar | OK | OK | Popovers/selects themed |
| DatePicker | OK | OK | Popover + calendar contrast fixed |
| Select editors | OK | OK | Chip pastels keep dark text (Notion) |
| Settings theme | OK | OK | Explicit control, persists |

## Residual (non-blocking)
- A few illustration Storybook fixtures still use literal cream hex.
- Marketing page soft shadows still use warm `rgba(55,53,47,…)` (tint OK per Impeccable; could later tokenize).
- Select chip pastels are fixed hex (by design for Notion tags); not theme-remapped.

## Impeccable alignment
- Avoided pure `#000` body ink; dark uses warm lacquer + 81% white.
- No nested card-in-card on settings.
- Detector scan on `components/ui` completed with exit 0.
