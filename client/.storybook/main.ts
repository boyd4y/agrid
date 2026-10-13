import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";
import { mergeConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "../src"),
          "@tabdo/shared": path.resolve(__dirname, "../../shared/src/index.ts"),
        },
      },
    });
  },
};

export default config;
