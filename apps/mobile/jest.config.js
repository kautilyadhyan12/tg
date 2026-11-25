// The screen tests: a screen drawn by React Native's own test tools. The rules
// that need no screen stay on vitest (test/*.test.ts).
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/test/screens/**/*.test.tsx"],
  setupFiles: ["react-native-gesture-handler/jestSetup.js", "<rootDir>/test/screens/setup.js"],
  setupFilesAfterEnv: ["<rootDir>/test/screens/clearWaiting.js"],
  // A screen is slow to draw on a busy machine; a test that hangs still fails.
  testTimeout: 20000,
  // On the laptop, five copies of Node at a time, each started again past 1 GB: two folders share
  // its 16 GB and the default is one copy for each of its 12 cores but one (Kd, 2026-11-08).
  // GitHub (CI set): three copies, each started again past 1 GB; the screen tests have a machine of 4 cores and 16 GB to
  // themselves there (.github/workflows/ci.yml). With no limit and six other packages beside them, the 1,504 tests of
  // 2026-11-24 ran that machine out of memory (37l).
  ...(process.env.CI ? { maxWorkers: 3, workerIdleMemoryLimit: "1GB" } : { maxWorkers: 5, workerIdleMemoryLimit: "1GB" }),
  // @app/shared is TypeScript whose imports end in ".js" (the api's module rules).
  moduleNameMapper: { "^([.]{1,2}/.*)[.]js$": "$1" },
};
