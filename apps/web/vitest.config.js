import { defineConfig } from "vitest/config";

// The engine adapter takes plain arrays/objects — no DOM needed here, so the
// node environment keeps these tests fast. The React hook/UI tests (P1.10b-2)
// will add a jsdom project when they land.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
