import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "min-h-[80px]",
        sm: "min-h-[60px] px-2.5 py-1.5 text-xs",
      },
    },
    defaultVariants: { size: "default" },
  }
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textareaVariants>
>(({ className, size, ...props }, ref) => (
  <textarea className={cn(textareaVariants({ size }), className)} ref={ref} {...props} />
));
Textarea.displayName = "Textarea";
