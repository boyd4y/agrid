# bloub engine

Framework-independent source from [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub), revision `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`, under the included MIT license.

`components/agents/BotAvatar.tsx` renders the upstream engine's frozen idle frame in React. `BotAvatarPicker.tsx` uses its shapes, expressions and colors. No Vue runtime, animation clock, remote image service or file upload is needed. The `auto` color is tabdo's semantic foreground, so it follows the theme.

Only the non-test engine modules are vendored. No changes to the upstream geometry or measurements.
