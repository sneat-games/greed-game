import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
    // engine + bot tests are pure logic (node env); ui tests touch the DOM.
    // Default to node and let the glob below promote the ui/ ones to jsdom.
    environment: "node",
    environmentMatchGlobs: [["src/ui/**/*.test.ts", "jsdom"]],
  },
});
