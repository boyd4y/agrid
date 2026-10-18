"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import { BoldIcon } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const BoldToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={editor.isActive("bold") ? "secondary" : "ghost"}
            size="icon"
            type="button"
            aria-label={labels.bold}
            aria-pressed={editor.isActive("bold")}
            className={cn(
              "size-8 p-0",
              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleBold().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().toggleBold().run()}
            ref={ref}
            {...props}
          >
            {children ?? <BoldIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.bold}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

BoldToolbar.displayName = "BoldToolbar";

export { BoldToolbar };
