# @tabdo/ui

Shared React components and design tokens. The package has no application API, translation provider, or theme provider dependency.

```tsx
import { Button } from "@tabdo/ui/components/button";
import { ColorPicker } from "@tabdo/ui/components/color-picker";
import { cn } from "@tabdo/ui/lib/utils";
import "@tabdo/ui/globals.css";
```

Consumers add `@tabdo/ui: "workspace:*"` to their dependencies. Components are exported as TypeScript source for the consumer's bundler. The shared stylesheet scans this package's components; consumers must also scan their own source.

Components use English defaults. Supply `labels`, `label`, `closeLabel`, or preset labels to localize controls. Supply `locale` to `DatePicker` for the calendar. Application adapters should resolve business values such as stored color tokens before passing HEX colors to `ColorPicker`.

Set the document root's `.dark` class to switch design tokens, including portaled dialogs and popovers. Pass the resolved `theme` to `Toaster`; the package does not own theme preferences or storage. Deletion and refresh callbacks remain owned by the caller.

From the repository root:

```sh
pnpm --filter @tabdo/ui storybook
pnpm --filter @tabdo/ui build-storybook
pnpm --filter @tabdo/ui typecheck
```

Storybook runs on port 6006 by default. For an independent instance use `pnpm --filter @tabdo/ui exec storybook dev -p 6016 --ci --no-open`. The toolbar switches light and dark themes; examples use local state and do not call application APIs.

For component documentation and project inspection, run `pnpm shadcn:ui docs select input button` or `pnpm shadcn:ui info --json` from the repository root. `pnpm shadcn` targets the client app. These use the pinned official CLI and the configured workspace aliases; see [CLI and proxy notes](../../docs/shadcn-cli.md).
