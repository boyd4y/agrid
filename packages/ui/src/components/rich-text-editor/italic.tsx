"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import { ItalicIcon } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const ItalicToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={editor.isActive("italic") ? "secondary" : "ghost"}
            size="icon"
            type="button"
            aria-label={labels.italic}
            aria-pressed={editor.isActive("italic")}
            className={cn(
              "size-8 p-0",
              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleItalic().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().toggleItalic().run()}
            ref={ref}
            {...props}
          >
            {children ?? <ItalicIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.italic}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

ItalicToolbar.displayName = "ItalicToolbar";

export { ItalicToolbar };
