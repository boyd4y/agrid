import * as React from "react";
import { DropdownMenu as Primitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@tabdo/ui/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;
export function DropdownMenuRadioItem({ children, className, ...props }: React.ComponentProps<typeof Primitive.RadioItem>) {
  return <Primitive.RadioItem className={cn("relative flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", className)} {...props}>
    {children}<span className="absolute right-2 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Check aria-hidden /></Primitive.ItemIndicator></span>
  </Primitive.RadioItem>;
}
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn("popover-surface z-50 min-w-40 max-h-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground outline-none", className)} {...props} /></Primitive.Portal>;
}
export function DropdownMenuItem({ className, variant = "default", ...props }: React.ComponentProps<typeof Primitive.Item> & { variant?: "default" | "destructive" }) {
  return <Primitive.Item data-variant={variant} className={cn("relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", variant === "destructive" && "text-destructive focus:bg-destructive/10 focus:text-destructive", className)} {...props} />;
}
export function DropdownMenuLabel(props: React.ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className="px-2 py-1.5 text-xs text-muted-foreground" {...props} />;
}
export function DropdownMenuSeparator(props: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className="my-1 h-px bg-border" {...props} />;
}
