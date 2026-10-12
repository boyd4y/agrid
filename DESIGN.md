# Design system — Agrid

> **Internal only.** Design tokens are not published on `/docs`. Source of truth:
> `client/src/index.css` (runtime semantic CSS variables).
> `client/src/lib/agrid-tokens.ts` contains a fixed illustration/brand palette, not a runtime theme mirror.
> Do not add a public docs page or marketing link for tokens.


## Tokens (shadcn semantic)
Surfaces: `background`, `card`, `popover`, `muted`, `accent`, `secondary`
Text: `foreground`, `muted-foreground`, `card-foreground`, `popover-foreground`
Chrome: `border`, `input`, `ring`
Brand: `primary` / `primary-foreground` (Notion blue)
Danger: `destructive`
Status: `warning`, `success`, `agent`; modal scrim: `overlay`

Light: warm paper white `#ffffff` / ink `#37352f` / cream muted `#f7f6f3` / border `#e3e2de`
Dark: warm lacquer `#191919` / raised `#202020` / muted `#2f2f2f` / border `#404040` / ink `rgba(255,255,255,0.81)` — never pure `#000` / `#fff` for body text.

## Rules (Impeccable-aligned)
1. Prefer Tailwind semantic classes over raw hex / `slate-*` / `bg-white`.
2. Popovers, calendars, selects use `bg-popover text-popover-foreground border-border`.
3. Selected calendar day: `bg-foreground text-background` (readable in both themes).
4. Select chips keep pastel Notion palette (readable on both; text stays dark on pastel).
5. Focus rings use `ring-ring`, never browser default blue glow on every control.
6. Avoid nesting Card-in-Card; one surface elevation per region.

## Theme
`ThemeProvider` + `localStorage table-theme` (`light` | `dark` | `system`). FOUC script on `index.html`.
The root `.dark` class is the sole dark selector. Tailwind v4 uses
`@custom-variant dark (&:where(.dark, .dark *));`; `@theme inline` maps utilities
to shadcn semantic variables. `data-theme` is an informational mirror only.
OS preference changes update both the resolved React context and root class.

## Workspace layout
`AppPageHeader` uses the same menu name and 20px icon as the sidebar, from
`APP_NAVIGATION`. Page headers have a full-width semantic bottom border, common
padding, title/description on the left and primary action on the right.
List content fills the available width; only dialogs and readable prose constrain width.

`AppEmptyState` supplies the shared illustration size, typography, spacing and
action placement for AI, tables, automations, agents and members. Original
Notioly SVGs are decorative and invert in dark mode. Creation/invitation forms
use Radix dialogs; deletion uses an explicit confirmation dialog.

Public forms keep their explicitly selected theme. Their scoped semantic
variables must remain readable independently of the workspace theme.
