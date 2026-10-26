import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/shared/**", "src/server/**"],
      exclude: ["src/server/index.ts", "src/server/seed-cli.ts"],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
