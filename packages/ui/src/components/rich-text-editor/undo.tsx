"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";
import { Undo2 } from "lucide-react";
import React from "react";

const UndoToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={labels.undo}
            className={cn("size-8 p-0", className)}
            onClick={(e) => {
              editor?.chain().focus().undo().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().undo().run()}
            ref={ref}
            {...props}
          >
            {children ?? <Undo2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.undo}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

UndoToolbar.displayName = "UndoToolbar";

export { UndoToolbar };

