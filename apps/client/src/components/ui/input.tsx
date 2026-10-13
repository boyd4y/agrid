import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full rounded-md border border-input bg-background text-foreground outline-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-9 px-3 py-1 text-sm",
        sm: "h-8 px-2.5 py-1 text-xs",
        lg: "h-10 px-3 text-base",
      },
    },
    defaultVariants: { size: "default" },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", size, ...props }, ref) => (
    <input
      type={type === "date" || type === "color" ? "text" : type}
      className={cn(inputVariants({ size }), className)}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { inputVariants };
