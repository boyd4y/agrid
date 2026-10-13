import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@tabdo/ui/lib/utils";

// Same Radix primitives as shadcn Sheet; nonmodal callers can keep the main page interactive.
export const Sheet = SheetPrimitive.Root;
export const SheetClose = SheetPrimitive.Close;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;
export const SheetOverlay = React.forwardRef<React.ComponentRef<typeof SheetPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>>(({ className, ...props }, ref) => <SheetPrimitive.Overlay ref={ref} data-slot="sheet-overlay" className={cn("fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0", className)} {...props} />);
SheetOverlay.displayName = "SheetOverlay";
export const SheetContent = React.forwardRef<React.ComponentRef<typeof SheetPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>>(({ className, ...props }, ref) => <SheetPrimitive.Portal><SheetOverlay /><SheetPrimitive.Content ref={ref} data-slot="sheet-content" className={cn("fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-border bg-background text-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-200", className)} {...props} /></SheetPrimitive.Portal>);
SheetContent.displayName = "SheetContent";
export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex shrink-0 flex-col gap-1.5 border-b border-border p-4", className)} {...props} />; }
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-border p-4", className)} {...props} />; }
