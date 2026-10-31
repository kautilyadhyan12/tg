// The screen tests: a screen drawn by React Native's own test tools. The rules
// that need no screen stay on vitest (test/*.test.ts).
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/test/screens/**/*.test.tsx"],
  setupFiles: ["react-native-gesture-handler/jestSetup.js", "<rootDir>/test/screens/setup.js"],
  // A screen is slow to draw on a busy machine; a test that hangs still fails.
  testTimeout: 20000,
  // @app/shared is TypeScript whose imports end in ".js" (the api's module rules).
  moduleNameMapper: { "^([.]{1,2}/.*)[.]js$": "$1" },
};
