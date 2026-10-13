import type { Preview } from "@storybook/react";
import { createElement, useEffect, type ReactNode } from "react";
import "../src/styles/globals.css";

function ThemeFrame({ children, theme }: { children: ReactNode; theme: string }) {
  useEffect(() => {
    // Radix and Sonner render portals outside the story's wrapper.
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return createElement("div", { className: "min-h-screen w-full bg-background p-6 text-foreground" }, children);
}

const preview: Preview = {
  initialGlobals: { theme: "light" },
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: {
        icon: "circlehollow",
        items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }],
        dynamicTitle: true,
      },
    },
  },
  decorators: [(Story, context) => createElement(ThemeFrame, { theme: context.globals.theme ?? "light", children: createElement(Story) })],
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
