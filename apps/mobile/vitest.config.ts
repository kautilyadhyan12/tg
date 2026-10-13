import { defineConfig } from "vitest/config";

// test/screens is jest's (jest.config.js): a screen needs React Native's own test tools.
export default defineConfig({
  test: { include: ["test/*.test.ts"] },
});
