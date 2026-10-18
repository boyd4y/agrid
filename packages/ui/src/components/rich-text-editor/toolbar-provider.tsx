"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.

import type { Editor } from "@tiptap/react";
import React from "react";
import type { RichTextLabels } from "../rich-text-editor";

export interface ToolbarContextProps {
  editor: Editor;
  labels: RichTextLabels;
  disabled?: boolean;
}

export const ToolbarContext = React.createContext<ToolbarContextProps | null>(
  null,
);

interface ToolbarProviderProps {
  editor: Editor;
  labels: RichTextLabels;
  disabled?: boolean;
  children: React.ReactNode;
}

export const ToolbarProvider = ({ editor, labels, disabled, children }: ToolbarProviderProps) => {
  return (
    <ToolbarContext.Provider value={{ editor, labels, disabled }}>
      {children}
    </ToolbarContext.Provider>
  );
};

export const useToolbar = () => {
  const context = React.useContext(ToolbarContext);

  if (!context) {
    throw new Error("useToolbar must be used within a ToolbarProvider");
  }

  return context;
};
