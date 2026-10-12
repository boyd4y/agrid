# Design system — Agrid

> **Internal only.** Design tokens are not published on `/docs`. Source of truth:
> `client/src/index.css` (CSS variables) and `client/src/lib/agrid-tokens.ts` (TS mirror).
> Do not add a public docs page or marketing link for tokens.


## Tokens (shadcn semantic)
Surfaces: `background`, `card`, `popover`, `muted`, `accent`, `secondary`
Text: `foreground`, `muted-foreground`, `card-foreground`, `popover-foreground`
Chrome: `border`, `input`, `ring`
Brand: `primary` / `primary-foreground` (Notion blue)
Danger: `destructive`

Light: warm paper white `#ffffff` / ink `#37352f` / cream muted `#f7f6f3` / border `#e3e2de`
Dark: warm lacquer `#191919` / raised `#202020` / muted `#2f2f2f` / border `#373737` / ink `rgba(255,255,255,0.81)` — never pure `#000` / `#fff` for body text.

## Rules (Impeccable-aligned)
1. Prefer Tailwind semantic classes over raw hex / `slate-*` / `bg-white`.
2. Popovers, calendars, selects use `bg-popover text-popover-foreground border-border`.
3. Selected calendar day: `bg-foreground text-background` (readable in both themes).
4. Select chips keep pastel Notion palette (readable on both; text stays dark on pastel).
5. Focus rings use `ring-ring`, never browser default blue glow on every control.
6. Avoid nesting Card-in-Card; one surface elevation per region.

## Theme
`ThemeProvider` + `localStorage table-theme` (`light` | `dark` | `system`). FOUC script on `index.html`.
