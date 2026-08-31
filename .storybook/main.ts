import type { StorybookConfig } from "@storybook/nextjs";
import type { StorybookConfigVite } from "@storybook/builder-vite";
import path from "path";

const config: StorybookConfig & StorybookConfigVite = {
  stories: ["../components/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/nextjs",
    options: {
      nextConfigPath: path.resolve(__dirname, "../next.config.js"),
    },
  },
  docs: {
    autodocs: true,
  },
  staticDirs: ["../public"],
  core: {
    builder: "@storybook/builder-vite",
  },
  async viteFinal(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": path.resolve(__dirname, "../"),
    };
    return config;
  },
};

export default config;
