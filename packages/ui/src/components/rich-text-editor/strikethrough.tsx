// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
"use client";

import { Strikethrough } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const StrikeThroughToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={editor.isActive("strike") ? "secondary" : "ghost"}
            type="button"
            aria-label={labels.strike}
            aria-pressed={editor.isActive("strike")}
            size="icon"
            className={cn(
              "size-8 p-0",

              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleStrike().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().toggleStrike().run()}
            ref={ref}
            {...props}
          >
            {children ?? <Strikethrough  />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.strike}</span>

        </TooltipContent>
      </Tooltip>
    );
  },
);

StrikeThroughToolbar.displayName = "StrikeThroughToolbar";

export { StrikeThroughToolbar };
