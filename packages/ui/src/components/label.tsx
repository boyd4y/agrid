import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@tabdo/ui/lib/utils";

const labelVariants = cva(
  "font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      size: {
        default: "text-sm",
        sm: "text-xs text-muted-foreground",
      },
    },
    defaultVariants: { size: "sm" },
  }
);

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & VariantProps<typeof labelVariants>
>(({ className, size, ...props }, ref) => (
  <label ref={ref} className={cn(labelVariants({ size }), className)} {...props} />
));
Label.displayName = "Label";
