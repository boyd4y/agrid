"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import { Redo2 } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const RedoToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={labels.redo}
            className={cn("size-8 p-0", className)}
            onClick={(e) => {
              editor?.chain().focus().redo().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().redo().run()}
            ref={ref}
            {...props}
          >
            {children ?? <Redo2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.redo}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

RedoToolbar.displayName = "RedoToolbar";

export { RedoToolbar };
