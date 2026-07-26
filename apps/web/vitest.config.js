import { defineConfig } from "vitest/config";

// The engine adapter and the pure API-layer tests take plain arrays/objects — no
// DOM needed, so the node environment keeps them fast and stays the default.
//
// ROUND 4 F1 added the jsdom half this comment used to only promise ("will add a
// jsdom project when they land"). The reason is not tidiness: four T3 rounds
// hardened a REGEX battery against source TEXT, and each round's battery was
// defeated by the next round's ordinary-looking edit — ten bypasses in total,
// including a destructure, an arbitrary new boolean name, and comment-poison
// placed below the last helper call. A guard that reads source can always be
// spelled around. A guard that RENDERS the page and reads the output cannot: it
// does not care how a fabrication was written, only that a number nobody knows
// reached the screen. Files named *.render.test.jsx get a DOM; nothing else does.
//
// `esbuild.jsx: "automatic"` rather than @vitejs/plugin-react: the plugin is
// installed and was tried first, but under vitest it does not apply — every
// component threw "React is not defined", i.e. the CLASSIC runtime, which is not
// what vite.config.js builds the app with. Setting the transform here makes the
// test build match the app build instead of leaving a dead plugin in the config.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.render.test.jsx", "jsdom"]],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
