import type { HTMLAttributes, ReactNode } from "react";
import { NotiolyImage } from "@/components/illustrations/NotiolyImage";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  illustration: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
};

/** One empty-state layout for workspace pages and their primary panels. */
export function AppEmptyState({ illustration, title, description, action, className, ...props }: Props) {
  return (
    <div className={cn("flex min-h-[360px] w-full flex-col items-center justify-center bg-background px-6 py-10 text-center", className)} {...props}>
      <NotiolyImage src={illustration} alt="" className="mb-6 max-w-48" />
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
