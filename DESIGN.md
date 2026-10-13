# Design system — tabdo

> **Internal only.** Design tokens are not published on `/docs`. Source of truth:
> `client/src/index.css` (runtime semantic CSS variables).
> Illustration colors stay with their assets and components; application controls use the semantic theme variables in `client/src/index.css`.
> Do not add a public docs page or marketing link for tokens.

## Signature (one hero memory)

The only hero signature is **Auth orchestration art + TabdoLogo geometry** (two blocks, upward arrow). Workspace chrome and marketing Persuade surfaces must reinforce that identity — do not invent a second card/gradient language on `/` or `/docs`.

## Tokens (shadcn semantic)

Surfaces: `background`, `card`, `popover`, `muted`, `accent`, `secondary`  
Text: `foreground`, `muted-foreground`, `card-foreground`, `popover-foreground`  
Chrome: `border`, `input`, `ring`  
Brand / **action**: `primary` / `primary-foreground` — **tabdo 行动蓝** (`#1769b7` light / `#5ba5d3` dark). Stop calling it “Notion blue” in docs or comments.  
Danger: `destructive`  
Status: `warning`, `success`, `agent`; modal scrim: `overlay`  
Illustration softs: `--tabdo-*-soft` / `illus-*` only — never on controls.

Light: warm paper white `#ffffff` / ink `#37352f` / cream muted `#f7f6f3` / border `#e3e2de`  
Dark: warm lacquer `#191919` / raised `#202020` / muted `#2f2f2f` / border `#404040` / ink `rgba(255,255,255,0.81)` — never pure `#000` / `#fff` for body text.

Select chips use the shared pastel palette in `client/src/lib/select-colors.ts` (`SELECT_COLORS`). Text stays dark on pastel in both themes.

## Density dual track

| Track | Routes | Language |
|---|---|---|
| **Operate** | `/app/*` | Tight spacing, more orthogonal corners, **border > shadow**, power-user density |
| **Persuade** | `/`, `/docs`, `/blog`, auth | Same color system and Logo geometry, larger breathing room — not a parallel SaaS card kit |

## Rules (Impeccable-aligned)

1. Prefer Tailwind semantic classes over raw hex / `slate-*` / `bg-white`.
2. Popovers, calendars, selects use `bg-popover text-popover-foreground border-border`.
3. Selected calendar day: `bg-foreground text-background` (readable in both themes).
4. Select chips keep pastel palette (readable on both; text stays dark on pastel).
5. Focus rings use `ring-ring`, never browser default blue glow on every control.
6. Avoid nesting Card-in-Card; one surface elevation per region.
7. **Chrome icons:** prefer `Ni*` for workspace chrome (nav, FAB, drawers). Lucide only for chart/business glyphs (e.g. reports) when no Ni equivalent exists. Target ~20px nav / ~16px controls.
8. **Section labels:** sentence case (or plain Chinese). No `uppercase tracking-wider` eyebrows in workspace chrome.
9. **Motion:** honor `prefers-reduced-motion: reduce` — kill nonessential transitions, hover lifts, and decorative animation. Keep instant state feedback.
10. **Naming:** product surfaces use **tabdo** only. No user-visible `agrid` / `Agrid`. Storage keys and custom events use `tabdo.*` / `tabdo:*` (one-time migrate from legacy `agrid.*` when needed).

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
action placement for 对话, tables, automations, agents and members. Original  
Notioly SVGs are decorative and invert in dark mode. Creation/invitation forms  
use Radix dialogs; deletion uses an explicit confirmation dialog.

Navigation vocabulary: home chat = **对话**; agent config = **智能体** — distinct icons, never share one glyph.

Public forms keep their explicitly selected theme. Their scoped semantic  
variables must remain readable independently of the workspace theme.

## tabdo logo

Use the shared `TabdoLogo` component for the brand mark and wordmark. The mark comes from the user-provided `tabdo-ai-logo-kit`: two blocks connected by an upward arrow. Keep its original geometry and transparent background. Use the ink SVG (`#231F20`) on light surfaces and the white SVG (`#FFFFFF`) on dark surfaces. Tailwind `dark:` utilities switch the files using the app’s resolved `.dark` theme, including manual theme settings that differ from the OS. The browser favicon follows the resolved app theme as well. Standalone light, dark, monochrome and outlined wordmark exports live in [`docs/brand`](docs/brand/README.md).
