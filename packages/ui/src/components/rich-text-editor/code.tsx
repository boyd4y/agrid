// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
"use client";

import { Code2 } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@tabdo/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tabdo/ui/components/tooltip";
import { cn } from "@tabdo/ui/lib/utils";
import { useToolbar } from "./toolbar-provider";

const CodeToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor, labels, disabled } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={editor.isActive("code") ? "secondary" : "ghost"}
            type="button"
            aria-label={labels.code}
            aria-pressed={editor.isActive("code")}
            size="icon"
            className={cn(
              "size-8 p-0",

              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleCode().run();
              onClick?.(e);
            }}
            disabled={disabled || !editor?.can().chain().focus().toggleCode().run()}
            ref={ref}
            {...props}
          >
            {children ?? <Code2  />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{labels.code}</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

CodeToolbar.displayName = "CodeToolbar";

export { CodeToolbar };
