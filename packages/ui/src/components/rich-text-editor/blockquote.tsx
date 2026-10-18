"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import { TextQuote } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const BlockquoteToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={editor.isActive("blockquote") ? "secondary" : "ghost"}
            size="icon"
            type="button"
            aria-label={labels.quote}
            aria-pressed={editor.isActive("blockquote")}
            className={cn(
              "size-8 p-0",
              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleBlockquote().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().toggleBlockquote().run()}
            ref={ref}
            {...props}
          >
            {children ?? <TextQuote />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.quote}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

BlockquoteToolbar.displayName = "BlockquoteToolbar";

export { BlockquoteToolbar };
