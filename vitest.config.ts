import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/{integration,unit}/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
