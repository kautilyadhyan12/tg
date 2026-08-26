import { defineConfig } from "vitest/config";

// THE TEST ZONE IS PINNED, AND IT IS A CORRECTNESS GATE, NOT A PREFERENCE.
// T3 round 1 F2, proven rather than argued: with the workout calendar's day
// bucketing mutated to the UTC day (`iso.split('T')[0]` — the exact defect
// `localDateKey` exists to prevent), both calendar suites went 57/57 GREEN
// under TZ=UTC and RED under Asia/Kolkata. GitHub runners are UTC, so the
// guard was inert on the machine that gates merges, while the local mutation
// table read "23/23 RED" and looked like protection.
//
// Under UTC the local day and the UTC day are IDENTICAL BY DEFINITION, so no
// fixture can tell the two implementations apart — this cannot be fixed in
// test data, only by giving the run a zone with a real offset.
//
// ASIA/KOLKATA IS CHOSEN FOR ITS CLOCK, NOT FOR THE MARKET — corrected
// 2026-08-26, because the line here used to justify it as "the product's own
// market" and Kd's market is the UNITED STATES (ruled 2026-08-18). Two
// properties are what earn the pin, and no US zone has both: a **half-hour**
// offset (+05:30), which catches a whole class of arithmetic that a whole-hour
// zone lets through, and **no DST**, so a date fixture cannot drift twice a
// year and turn this gate into a seasonal flake. A US zone would give up the
// second one — America/Chicago moves twice a year — so pinning "our market"
// here would make the suite worse, which is the point worth leaving behind.
// Set here rather than in ci.yml so a local run and a CI run answer the same
// question.
process.env.TZ = "Asia/Kolkata";

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
