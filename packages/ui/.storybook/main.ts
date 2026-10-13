import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: { name: "@storybook/react-vite", options: {} },
  previewHead: (head) => `${head}<link rel="icon" type="image/svg+xml" href="./favicon.svg" />`,
  async viteFinal(config) {
    return mergeConfig(config, { plugins: [tailwindcss()] });
  },
};

export default config;
