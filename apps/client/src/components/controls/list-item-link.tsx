import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

/** The parent owns the item's bounds; independent actions sit above this sibling link. */
export function ListItemLink({ label, className, ...props }: Omit<LinkProps, "children" | "aria-label"> & { label: string }) {
  return <Link {...props} aria-label={label} className={cn("absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}><span className="sr-only">{label}</span></Link>;
}
