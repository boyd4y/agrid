# Dark/light consistency audit — 2026-10-12

Internal implementation notes; not a public documentation page.

## Findings and changes

- Dark mode previously mixed media-query, attribute and class selectors. The
  root `.dark` class now drives both semantic variables and Tailwind `dark:`
  utilities. Bootstrap and ThemeProvider share the light/dark/system contract,
  tolerate inaccessible storage and follow OS preference changes.
- Fixed light-only backgrounds, black hover fills, status colors and modal
  scrims in workspace, marketing, documentation, table/form and chat surfaces.
  Runtime UI uses shadcn semantic tokens. Brand artwork, pastel data tags and
  image-viewer controls retain their intentional fixed palettes.
- Adjusted primary/destructive button pairs and muted/status text for contrast
  in both themes. Popovers/selects/calendars share a stronger border and shadow;
  cells expose hover, focus and editing states, and header menus appear on
  hover or keyboard focus.
- Workspace pages fill their pane. Main page headers share layout, border,
  menu names and icon components with the sidebar. Empty states share one
  component and original assets from the user's Notioly Free Pack.
- Appearance switching is available directly in the sidebar and marketing
  header. Agent creation and member invitation use dialogs; table and rule
  deletion are available from list pages with confirmation and error handling.
- Public form presets scope their own semantic tokens so workspace dark mode
  does not override the selected form appearance.

## Validation and limits

`node --test client/scripts/ui-regressions.test.mjs`: 10 passing regressions,
covering organization initialization/deduplication, draft thread metadata,
first-paint theme combinations, the unified selector and core color contrast.
Core text/button pairs and tinted notices meet 4.5:1 in the checked combinations;
this is not a full accessibility certification.

Client TypeScript/build and `git diff --check` are the final release checks.
The Impeccable detector reports no findings for the shared shell and app pages.
Browser automation was interrupted by concurrent browser use and an unavailable
extension connection, so final visual checks, dialog focus checks and live
request-rate measurements remain unverified. Regression tests establish the
session-loop and draft metadata fixes at the code level. No user data was
deleted and no invitation was sent during validation.

## Reference conventions

- [shadcn semantic theming](https://ui.shadcn.com/docs/theming)
- [shadcn Vite dark mode](https://ui.shadcn.com/docs/dark-mode/vite)
- [Tailwind class-based dark mode](https://tailwindcss.com/docs/dark-mode)
- [Notioly original illustrations](https://www.notioly.com/)
