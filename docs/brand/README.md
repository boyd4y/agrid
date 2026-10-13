# tabdo identity

The selected mark is supplied by the user in `~/Downloads/tabdo-ai-logo-kit`. It has two blocks connected by an upward arrow. The original geometry, transparent background and colors are preserved.

## Assets

| Asset | Usage |
| --- | --- |
| `tabdo-mark-ink.svg` | Original ink mark (`#231F20`) for light surfaces |
| `tabdo-mark-white.svg` | Original white mark (`#FFFFFF`) for dark surfaces |
| `tabdo-logo-icon-light.svg` / `tabdo-logo-icon-dark.svg` | Export aliases of the originals |
| `tabdo-logo-icon.svg` | Standalone mark that follows OS color scheme |
| `tabdo-logo-lockup-light.svg` / `tabdo-logo-lockup-dark.svg` | Mark with the existing outlined tabdo wordmark |
| `tabdo-logo-mono.svg` / `tabdo-logo-lockup-mono.svg` | Single-color exports |
| `tabdo-logo-preview.svg` | Light/dark proof at 16, 24, 32 and 64px |

The mark has a 96 × 100 viewBox. Preserve its aspect ratio; do not redraw, recolor, stretch or add a background tile. The standalone wordmark is SVG geometry without a font dependency.

## App integration

`TabdoLogo.tsx` uses the original files copied to `client/public/brand/`. Tailwind `dark:hidden` / `dark:block` switch the variants according to the app's `.dark` class, including explicit themes that differ from the OS. The favicon uses copies of these originals, selected both by the initial theme script and `ThemeProvider`. `/favicon.svg` and `/tabdo-mark.svg` are OS-adaptive standalone fallbacks.

`directions/` contains the earlier logo exploration. Those concepts are superseded by the supplied kit and are not production assets.
