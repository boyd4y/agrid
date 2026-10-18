import { forwardRef } from "react";
import { Search } from "lucide-react";
import { Input, type InputProps } from "./input";
import { cn } from "@tabdo/ui/lib/utils";

export interface SearchInputProps extends InputProps {
  containerClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn("relative", containerClassName)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} ref={ref} className={cn("pl-9", className)} />
    </div>
  )
);
SearchInput.displayName = "SearchInput";
