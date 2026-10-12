# Cell editors UI review (2026-10-11)

Screenshots: `screenshots/editors/final-*.png`, `r0*.png`

## Fixed this pass
1. **Select / 优先级 popover** — shared `SelectChip`; list chips match cell; padding so chips line up under cell chip; no native select.
2. **Multi-select / 标签** — removed 确定/取消; toggle on click, commit on close (Notion-like); no nested `<button>` (checkbox is a span).
3. **Date picker light/dark** — theme tokens on popover/input/calendar; selected day readable (dark chip + white text in light; light chip + dark text in dark).
4. **Filter select** — shows same chips for option values.
5. **Number cells** — right-aligned.
6. **data-cell / data-col-header** — for stable targeting.

## Verified
| Editor | Status |
|--------|--------|
| select (状态/优先级) | OK — chip style matches |
| multi_select | OK — no confirm/cancel |
| date light | OK — selected day contrast |
| date dark | OK — popover + selected contrast |
| person | OK |
| text / number / checkbox | OK |

## Remaining (non-blocking)
- App chrome still uses some hardcoded `slate-*` (sidebar/header) so dark theme mainly affects CSS-var surfaces (popover/calendar), not full chrome.
- Empty select cell shows "—" while person/date show "空" — unify later.
- Filter row density can still be tightened.
