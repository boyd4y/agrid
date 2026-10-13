import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@tabdo/ui/lib/utils";

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function TabsList({ className, variant = "default", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: "default" | "line" }) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn("group/tabs-list inline-flex h-9 items-center justify-center text-muted-foreground", variant === "default" ? "rounded-lg bg-muted p-1" : "gap-1 bg-transparent", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("relative inline-flex items-center justify-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-3 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:bg-foreground group-data-[orientation=vertical]/tabs-list:after:inset-x-auto group-data-[orientation=vertical]/tabs-list:after:inset-y-1 group-data-[orientation=vertical]/tabs-list:after:left-0 group-data-[orientation=vertical]/tabs-list:after:h-auto group-data-[orientation=vertical]/tabs-list:after:w-0.5", className)} {...props} />;
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}
