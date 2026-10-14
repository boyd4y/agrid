import type { HTMLAttributes, ReactNode } from "react";
import { NotiolyImage } from "@/components/illustrations/NotiolyImage";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  illustration: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  density?: "default" | "compact";
};

/** One empty-state layout for workspace pages and their primary panels. */
export function AppEmptyState({ illustration, title, description, action, density = "default", className, ...props }: Props) {
  return (
    <div className={cn("flex w-full flex-col items-center justify-center text-center", density === "compact" ? "min-h-64 px-4 py-6" : "min-h-[360px] bg-background px-6 py-10", className)} {...props}>
      <NotiolyImage src={illustration} alt="" className={cn(density === "compact" ? "mb-4 max-w-24" : "mb-6 max-w-48")} />
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className={density === "compact" ? "mt-4" : "mt-6"}>{action}</div>}
    </div>
  );
}
