# Column type audit (shadcn-only) — 2026-10-11

## Checklist

| Type | Display | Editor | Filter | Status |
|------|---------|--------|--------|--------|
| text | truncate / 空 | shadcn Input | shadcn Input | OK |
| number | tabular | shadcn Input | shadcn Input | OK |
| select | Notion soft Tag `h-[22px] px-[6px]` | **Popover + soft tags** | shadcn Select | **Fixed** (was absolute custom dropdown) |
| multi_select | soft Tags | **Popover + soft tags + shadcn Checkbox** | shadcn Select | **Fixed** |
| date | `formatDateDisplay(config.dateFormat)` | **DatePicker: Calendar + manual Input + clear** | DatePicker | **Fixed** (was plain text Input) |
| checkbox | shadcn Checkbox | shadcn Checkbox | shadcn Select | OK |
| person | soft chip even pad | Popover member list | Input | OK |
| formula | mono / #ERR | read-only | n/a | OK |

## Hard rules verified
- Grep `client/src`: **zero** native `<select>` / `type=date` / `type=color`
- `Input` coerces date/color → text
- Badge / Tag / person chip: even `h-[22px] px-[6px]`
- Date storage `YYYY-MM-DD`; display via `ColumnConfig.dateFormat` (column settings)

## Screenshots
