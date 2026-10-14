import * as React from "react";
import { cn } from "@tabdo/ui/lib/utils";

/** A bordered list row with shared pointer and keyboard feedback. */
export const ListItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ className, ...props }, ref) => (
  <li ref={ref} data-slot="list-item" className={cn("relative rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/40 focus-within:bg-muted/40", className)} {...props} />
));
ListItem.displayName = "ListItem";
